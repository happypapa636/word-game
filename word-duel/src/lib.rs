use async_graphql::{Request, Response};
use linera_sdk::linera_base_types::{ChainId, ContractAbi, ServiceAbi};
use serde::{Deserialize, Serialize};

pub struct WordDuelAbi;

impl ContractAbi for WordDuelAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for WordDuelAbi {
    type Query = Request;
    type QueryResponse = Response;
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct WordDuelParameters;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InstantiationArgument;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, async_graphql::Enum)]
pub enum MatchStatus {
    WaitingForPlayer,
    Active,
    Ended,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, async_graphql::Enum)]
pub enum RoundPhase {
    HostToPlay,
    GuestToPlay,
    RoundComplete,
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct RoundRecord {
    pub round: u32,
    pub host_word: String,
    pub guest_word: String,
    pub host_points: u32,
    pub guest_points: u32,
    pub host_score: u32,
    pub guest_score: u32,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct PlayerInfo {
    pub chain_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct Game {
    pub match_id: String,
    pub host_chain_id: String,
    pub status: MatchStatus,
    pub players: Vec<PlayerInfo>,
    pub letters: String,
    pub total_rounds: u32,
    pub current_round: u32,
    pub host_score: u32,
    pub guest_score: u32,
    pub round_phase: RoundPhase,
    pub host_word: Option<String>,
    pub guest_word: Option<String>,
    pub winner_chain_id: Option<String>,
    pub history: Vec<RoundRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum Operation {
    CreateMatch {
        host_name: String,
        total_rounds: u32,
    },
    JoinMatch {
        host_chain_id: String,
        player_name: String,
    },
    SubmitWord { word: String },
    LeaveMatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CrossChainMessage {
    JoinRequest {
        player_chain_id: ChainId,
        player_name: String,
    },
    InitialStateSync { game: Game },
    WordSubmitted {
        round: u32,
        word: String,
    },
    RoundSync { game: Game },
    LeaveNotice { player_chain_id: ChainId },
}

/// Predefined letter sets for deterministic generation (no RNG in contract).
const LETTER_SETS: &[&str] = &[
    "ATRESN",
    "EXAMPL",
    "WORDLE",
    "LETTER",
    "STREAM",
    "CRANES",
    "PAINTS",
    "MASTER",
];

/// Picks a letter set by index (e.g. from match_id micros).
pub fn letters_for_match(match_id_micros: u64) -> String {
    let idx = (match_id_micros as usize) % LETTER_SETS.len();
    LETTER_SETS[idx].to_string()
}

/// Validates that `word` uses only characters from `letters` with correct counts, and len >= 3.
pub fn validate_word(letters: &str, word: &str) -> bool {
    let word = word.trim().to_uppercase();
    if word.len() < 3 {
        return false;
    }
    let letters_upper = letters.to_uppercase();
    let mut letter_counts: std::collections::HashMap<char, u32> = std::collections::HashMap::new();
    for c in letters_upper.chars() {
        if c.is_alphabetic() {
            *letter_counts.entry(c).or_insert(0) += 1;
        }
    }
    for c in word.chars() {
        if !c.is_alphabetic() {
            return false;
        }
        let count = letter_counts.get(&c).copied().unwrap_or(0);
        if count == 0 {
            return false;
        }
        letter_counts.insert(c, count - 1);
    }
    true
}

/// Score for a word: length if valid, 0 otherwise.
pub fn word_score(letters: &str, word: &str) -> u32 {
    if validate_word(letters, word) {
        word.trim().len() as u32
    } else {
        0
    }
}
