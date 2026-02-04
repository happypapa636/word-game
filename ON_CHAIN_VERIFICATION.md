# On-Chain Verification Guide

This document verifies that the Word Duel application is fully on-chain.

## On-Chain State Verification

### State Structure (word-duel/src/state.rs)

All persistent state uses Linera View types (`RegisterView`). No BTreeMap or plain Rust collections are used as root state. All state is stored on-chain:

```rust
#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct WordDuelState {
    pub game: RegisterView<Option<Game>>,           // On-chain
    pub my_word: RegisterView<Option<String>>,     // On-chain
    pub opponent_word: RegisterView<Option<String>>, // On-chain
    pub last_notification: RegisterView<Option<String>>, // On-chain
}
```

`Game` is a value type (serializable struct) stored inside the View, not a replacement for Views.

### Contract Operations (word-duel/src/contract.rs)

- All state reads use `self.state.*.get()` (on-chain reads).
- All state writes use `self.state.*.set(...)` (on-chain writes).
- No direct assignment to in-memory state that bypasses Views.
- `store()` calls `self.state.save().await` so persisted state is written on-chain.

Examples:
```rust
self.state.game.set(Some(game));        // On-chain write
self.state.my_word.set(Some(word));     // On-chain write
let game = self.state.game.get().clone(); // On-chain read
```

### Service Queries (word-duel/src/service.rs)

All GraphQL queries read from on-chain state:
- State is loaded with `WordDuelState::load(runtime.root_view_storage_context())`.
- All query data comes from `self.state.game.get()`, `self.state.my_word.get()`, etc.
- Mutations are performed by the contract via operations/messages; the service only schedules operations.

## No Backend Server

- **No Express/Node.js server**: All queries go directly to the Linera service.
- **GraphQL runs in WASM**: The service executes on your microchain.
- **No database**: All state is stored on-chain using Linera Views.
- **No REST API**: Only GraphQL queries to the on-chain service.

## Cross-Chain Communication

All player interactions use cross-chain messages:
- `JoinRequest`: Guest → Host (cross-chain)
- `InitialStateSync`: Host → Guest (cross-chain)
- `WordSubmitted`: Host ↔ Guest (cross-chain)
- `RoundSync`: Host → Guest (cross-chain)
- `LeaveNotice`: Player → Opponent (cross-chain)

## Verification Steps

### Step 1: Check Application ID

After `docker compose up`, you should see:
```
Application ID: <64-character-hex-string>
```
This confirms the contract is deployed on-chain.

### Step 2: Check Browser

1. Open http://localhost:5173
2. Open DevTools (F12) → Network tab
3. Create a match
4. Look for GraphQL requests to the Linera service
5. All queries should go to the on-chain service, not a backend server

### Step 3: Test Persistence

1. Create a match
2. Make a move (submit a word)
3. Refresh the page
4. State should persist (stored on-chain, not in memory)

### Step 4: Test Cross-Chain

1. Open two browser windows (or one normal + one incognito)
2. Create a match in window 1 (note the Room ID = microchain ID)
3. Join with that Room ID in window 2
4. Play a round in both windows
5. State should sync between windows via cross-chain messages

## Summary Checklist

- **State storage**: All state uses `RegisterView` (on-chain storage)
- **No backend server**: GraphQL service runs in WASM on the microchain
- **Cross-chain messages**: Players communicate via cross-chain messages
- **Persistent state**: Game state persists across page refreshes
- **Microchain architecture**: Each player has their own microchain
- **WASM execution**: Contract logic executes in WebAssembly
- **Linera Views**: All persistent data uses Linera's View system
