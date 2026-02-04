// All persistent state uses Linera View types (RegisterView). No BTreeMap or plain
// Rust collections as root state. Game is a value type (serializable struct) stored
// inside RegisterView<Option<Game>>, not a replacement for Views.
use linera_sdk::views::{linera_views, RegisterView, RootView, ViewStorageContext};
use word_duel::Game;

#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct WordDuelState {
    pub game: RegisterView<Option<Game>>,
    pub my_word: RegisterView<Option<String>>,
    pub opponent_word: RegisterView<Option<String>>,
    pub last_notification: RegisterView<Option<String>>,
}
