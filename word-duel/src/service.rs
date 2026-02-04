#![cfg_attr(target_arch = "wasm32", no_main)]

mod state;

use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{linera_base_types::WithServiceAbi, views::View, Service, ServiceRuntime};
use word_duel::{
    Game, MatchStatus, Operation, RoundPhase, RoundRecord, WordDuelAbi, WordDuelParameters,
};

use self::state::WordDuelState;

linera_sdk::service!(WordDuelService);

pub struct WordDuelService {
    state: WordDuelState,
    runtime: Arc<ServiceRuntime<Self>>,
}

impl WithServiceAbi for WordDuelService {
    type Abi = WordDuelAbi;
}

impl Service for WordDuelService {
    type Parameters = WordDuelParameters;

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = WordDuelState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        WordDuelService {
            state,
            runtime: Arc::new(runtime),
        }
    }

    async fn handle_query(&self, request: Request) -> Response {
        let game = self.state.game.get().clone();
        let my_word = self.state.my_word.get().clone();
        let opponent_word = self.state.opponent_word.get().clone();
        let last_notification = self.state.last_notification.get().clone();
        let schema = Schema::build(
            QueryRoot {
                game,
                chain_id: self.runtime.chain_id().to_string(),
                my_word,
                opponent_word,
                last_notification,
            },
            MutationRoot {
                runtime: self.runtime.clone(),
            },
            EmptySubscription,
        )
        .finish();
        schema.execute(request).await
    }
}

struct QueryRoot {
    game: Option<Game>,
    chain_id: String,
    my_word: Option<String>,
    opponent_word: Option<String>,
    last_notification: Option<String>,
}

#[Object]
impl QueryRoot {
    async fn game(&self) -> Option<&Game> {
        self.game.as_ref()
    }

    async fn match_status(&self) -> Option<MatchStatus> {
        self.game.as_ref().map(|g| g.status)
    }

    async fn letters(&self) -> Option<String> {
        self.game.as_ref().map(|g| g.letters.clone())
    }

    async fn round(&self) -> Option<i32> {
        self.game.as_ref().map(|g| g.current_round as i32)
    }

    async fn round_phase(&self) -> Option<RoundPhase> {
        self.game.as_ref().map(|g| g.round_phase)
    }

    async fn is_host(&self) -> bool {
        self.game
            .as_ref()
            .map(|g| g.host_chain_id == self.chain_id)
            .unwrap_or(false)
    }

    async fn opponent_chain_id(&self) -> Option<String> {
        let game = self.game.as_ref()?;
        game.players
            .iter()
            .find(|p| p.chain_id != self.chain_id)
            .map(|p| p.chain_id.clone())
    }

    async fn my_word(&self) -> Option<String> {
        self.my_word.clone()
    }

    async fn opponent_word(&self) -> Option<String> {
        self.opponent_word.clone()
    }

    async fn my_score(&self) -> Option<i32> {
        let game = self.game.as_ref()?;
        if game.host_chain_id == self.chain_id {
            Some(game.host_score as i32)
        } else {
            Some(game.guest_score as i32)
        }
    }

    async fn opponent_score(&self) -> Option<i32> {
        let game = self.game.as_ref()?;
        if game.host_chain_id == self.chain_id {
            Some(game.guest_score as i32)
        } else {
            Some(game.host_score as i32)
        }
    }

    async fn round_history(&self) -> Vec<RoundRecord> {
        self.game
            .as_ref()
            .map(|g| g.history.clone())
            .unwrap_or_default()
    }

    async fn last_round_record(&self) -> Option<RoundRecord> {
        self.game
            .as_ref()
            .and_then(|g| g.history.last().cloned())
    }

    async fn last_notification(&self) -> Option<String> {
        self.last_notification.clone()
    }
}

struct MutationRoot {
    runtime: Arc<ServiceRuntime<WordDuelService>>,
}

#[Object]
impl MutationRoot {
    async fn create_match(&self, host_name: String, total_rounds: i32) -> String {
        let total_rounds = total_rounds.max(1).min(20) as u32;
        self.runtime.schedule_operation(&Operation::CreateMatch {
            host_name: host_name.clone(),
            total_rounds,
        });
        format!("Match created by '{}'", host_name)
    }

    async fn join_match(&self, host_chain_id: String, player_name: String) -> String {
        self.runtime.schedule_operation(&Operation::JoinMatch {
            host_chain_id: host_chain_id.clone(),
            player_name: player_name.clone(),
        });
        format!("Join request sent to {}", host_chain_id)
    }

    async fn submit_word(&self, word: String) -> String {
        self.runtime
            .schedule_operation(&Operation::SubmitWord { word });
        "Word submitted".to_string()
    }

    async fn leave_match(&self) -> String {
        self.runtime.schedule_operation(&Operation::LeaveMatch);
        "Leave requested".to_string()
    }
}
