#![cfg_attr(target_arch = "wasm32", no_main)]

mod state;

use linera_sdk::{
    linera_base_types::{ChainId, WithContractAbi},
    views::{RootView, View},
    Contract, ContractRuntime,
};
use word_duel::{
    CrossChainMessage, Game, InstantiationArgument, MatchStatus, Operation, PlayerInfo,
    RoundPhase, RoundRecord, WordDuelParameters, word_score,
};

use self::state::WordDuelState;

linera_sdk::contract!(WordDuelContract);

pub struct WordDuelContract {
    state: WordDuelState,
    runtime: ContractRuntime<Self>,
}

impl WithContractAbi for WordDuelContract {
    type Abi = word_duel::WordDuelAbi;
}

impl WordDuelContract {
    fn is_host(&mut self, game: &Game) -> bool {
        game.host_chain_id == self.runtime.chain_id().to_string()
    }

    fn opponent_chain_id(&mut self, game: &Game) -> Option<ChainId> {
        let self_chain = self.runtime.chain_id().to_string();
        game.players
            .iter()
            .find(|p| p.chain_id != self_chain)
            .and_then(|p| p.chain_id.parse().ok())
    }

    fn reset_round_words(&mut self) {
        self.state.my_word.set(None);
        self.state.opponent_word.set(None);
    }

    fn can_play(&self, game: &Game) -> bool {
        game.status == MatchStatus::Active && game.players.len() == 2
    }
}

impl Contract for WordDuelContract {
    type Message = CrossChainMessage;
    type InstantiationArgument = InstantiationArgument;
    type Parameters = WordDuelParameters;
    type EventValue = ();

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = WordDuelState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        WordDuelContract { state, runtime }
    }

    async fn instantiate(&mut self, _argument: InstantiationArgument) {
        self.state.game.set(None);
        self.reset_round_words();
        self.state.last_notification.set(None);
    }

    async fn execute_operation(&mut self, operation: Operation) {
        match operation {
            Operation::CreateMatch {
                host_name,
                total_rounds,
            } => {
                let chain_id = self.runtime.chain_id().to_string();
                let match_id = self.runtime.system_time().micros();
                let letters = word_duel::letters_for_match(match_id);
                let game = Game {
                    match_id: match_id.to_string(),
                    host_chain_id: chain_id.clone(),
                    status: MatchStatus::WaitingForPlayer,
                    players: vec![PlayerInfo {
                        chain_id: chain_id.clone(),
                        name: host_name,
                    }],
                    letters,
                    total_rounds,
                    current_round: 1,
                    host_score: 0,
                    guest_score: 0,
                    round_phase: RoundPhase::HostToPlay,
                    host_word: None,
                    guest_word: None,
                    winner_chain_id: None,
                    history: Vec::new(),
                };
                self.state.game.set(Some(game));
                self.reset_round_words();
                self.state.last_notification.set(None);
            }

            Operation::JoinMatch {
                host_chain_id,
                player_name,
            } => {
                let target_chain: ChainId = host_chain_id.parse().expect("Invalid host chain ID");
                let player_chain_id = self.runtime.chain_id();
                self.runtime.send_message(
                    target_chain,
                    CrossChainMessage::JoinRequest {
                        player_chain_id,
                        player_name,
                    },
                );
            }

            Operation::SubmitWord { word } => {
                let mut game = self.state.game.get().clone().expect("Match not found");
                if !self.can_play(&game) {
                    panic!("Match not ready");
                }
                let word = word.trim().to_uppercase();
                if word.len() < 3 {
                    panic!("Word must be at least 3 letters");
                }

                if self.is_host(&game) {
                    if game.round_phase != RoundPhase::HostToPlay {
                        panic!("Not your turn");
                    }
                    if self.state.my_word.get().is_some() {
                        panic!("Already submitted");
                    }
                    self.state.my_word.set(Some(word.clone()));
                    game.host_word = Some(word.clone());
                    game.round_phase = RoundPhase::GuestToPlay;
                    self.state.game.set(Some(game.clone()));

                    if let Some(opponent) = self.opponent_chain_id(&game) {
                        self.runtime.send_message(
                            opponent,
                            CrossChainMessage::WordSubmitted {
                                round: game.current_round,
                                word,
                            },
                        );
                    }
                } else {
                    if game.round_phase != RoundPhase::GuestToPlay {
                        panic!("Not your turn");
                    }
                    if self.state.my_word.get().is_some() {
                        panic!("Already submitted");
                    }
                    self.state.my_word.set(Some(word.clone()));
                    if let Some(opponent) = self.opponent_chain_id(&game) {
                        self.runtime.send_message(
                            opponent,
                            CrossChainMessage::WordSubmitted {
                                round: game.current_round,
                                word,
                            },
                        );
                    }
                }
            }

            Operation::LeaveMatch => {
                if let Some(game) = self.state.game.get().clone() {
                    if let Some(opponent) = self.opponent_chain_id(&game) {
                        let player_chain_id = self.runtime.chain_id();
                        self.runtime.send_message(
                            opponent,
                            CrossChainMessage::LeaveNotice { player_chain_id },
                        );
                    }
                }
                self.state.game.set(None);
                self.reset_round_words();
                self.state.last_notification.set(None);
            }
        }
    }

    async fn execute_message(&mut self, message: Self::Message) {
        match message {
            CrossChainMessage::JoinRequest {
                player_chain_id,
                player_name,
            } => {
                let mut game = self.state.game.get().clone().expect("Match not found");
                if !self.is_host(&game) {
                    panic!("Only host can accept joins");
                }
                if game.status != MatchStatus::WaitingForPlayer {
                    panic!("Match not joinable");
                }
                if game.players.len() >= 2 {
                    panic!("Match full");
                }

                game.players.push(PlayerInfo {
                    chain_id: player_chain_id.to_string(),
                    name: player_name,
                });
                game.status = MatchStatus::Active;
                self.state.game.set(Some(game.clone()));
                self.reset_round_words();
                self.state
                    .last_notification
                    .set(Some("Player joined".to_string()));
                self.runtime
                    .send_message(player_chain_id, CrossChainMessage::InitialStateSync { game });
            }

            CrossChainMessage::InitialStateSync { game } => {
                self.state.game.set(Some(game));
                self.reset_round_words();
                self.state
                    .last_notification
                    .set(Some("Match ready".to_string()));
            }

            CrossChainMessage::WordSubmitted { round, word } => {
                let mut game = self.state.game.get().clone().expect("Match not found");
                if !self.can_play(&game) {
                    return;
                }
                if game.current_round != round {
                    return;
                }

                if self.is_host(&game) {
                    // Host receives guest's word; resolve the round
                    if game.guest_word.is_some() {
                        return;
                    }
                    game.guest_word = Some(word.clone());
                    self.state.opponent_word.set(Some(word.clone()));

                    let host_word = self
                        .state
                        .my_word
                        .get()
                        .clone()
                        .unwrap_or_default();
                    let host_points = word_score(&game.letters, &host_word);
                    let guest_points = word_score(&game.letters, &word);

                    game.host_score = game.host_score.saturating_add(host_points);
                    game.guest_score = game.guest_score.saturating_add(guest_points);

                    let timestamp = self.runtime.system_time().micros().to_string();
                    game.history.push(RoundRecord {
                        round: game.current_round,
                        host_word: host_word.clone(),
                        guest_word: word,
                        host_points,
                        guest_points,
                        host_score: game.host_score,
                        guest_score: game.guest_score,
                        timestamp: timestamp.clone(),
                    });
                    if game.history.len() > 50 {
                        let excess = game.history.len() - 50;
                        game.history.drain(0..excess);
                    }

                    game.current_round = game.current_round.saturating_add(1);
                    game.host_word = None;
                    game.guest_word = None;

                    if game.current_round > game.total_rounds {
                        game.status = MatchStatus::Ended;
                        game.winner_chain_id = Some(if game.host_score > game.guest_score {
                            game.host_chain_id.clone()
                        } else if game.guest_score > game.host_score {
                            game.players
                                .iter()
                                .find(|p| p.chain_id != game.host_chain_id)
                                .map(|p| p.chain_id.clone())
                                .unwrap_or_default()
                        } else {
                            String::new() // draw: no winner
                        });
                        game.round_phase = RoundPhase::RoundComplete;
                    } else {
                        game.round_phase = RoundPhase::HostToPlay;
                    }

                    self.state.game.set(Some(game.clone()));
                    self.reset_round_words();

                    if let Some(opponent) = self.opponent_chain_id(&game) {
                        self.runtime
                            .send_message(opponent, CrossChainMessage::RoundSync { game });
                    }
                } else {
                    // Guest receives host's word; show it and wait for my submit
                    if game.host_word.is_some() {
                        return;
                    }
                    game.host_word = Some(word.clone());
                    game.round_phase = RoundPhase::GuestToPlay;
                    self.state.opponent_word.set(Some(word));
                    self.state.game.set(Some(game));
                }
            }

            CrossChainMessage::RoundSync { game } => {
                self.state.game.set(Some(game));
                self.reset_round_words();
            }

            CrossChainMessage::LeaveNotice { player_chain_id: _ } => {
                self.state.game.set(None);
                self.reset_round_words();
                self.state
                    .last_notification
                    .set(Some("Opponent left".to_string()));
            }
        }
    }

    async fn process_streams(
        &mut self,
        _streams: Vec<linera_sdk::linera_base_types::StreamUpdate>,
    ) {
    }

    async fn store(mut self) {
        let _ = self.state.save().await;
    }
}
