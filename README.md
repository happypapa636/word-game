# Word Duel

A two-player turn-based word game built fully on-chain on **Linera**. Both players share the same set of letters each round, form words, and score points. The player with the higher total score after all rounds wins.

## What It Does

- **Create or join a room** — Host creates a match (and gets a room ID) or another player joins using that ID.
- **Play rounds** — Each round, both players see the same letters. Player A submits a word, then Player B submits a word using the same letters.
- **Scoring** — Valid words score points equal to the word length (e.g. EARN = 4). Invalid words or timeouts score 0.
- **Winner** — After a fixed number of rounds (e.g. 5), the player with the higher total score wins; equal scores is a draw.

## Game Rules

- **2 players** per match; both see the same letters and get equal turns.
- **Letters** — A set of letters (e.g. A, T, R, E, S, N) is chosen at game start and reused for every round in that match.
- **Words** must:
  - Use only the given letters
  - Not use any letter more often than it appears in the set
  - Be at least 3 letters long
- **Score** = length of the word (3 letters → 3 points, etc.). Invalid word or timeout → 0 points.
- **Rounds** — Host plays first each round, then the other player. After all rounds, higher total score wins; tie = draw.

## Tech Overview

- **On-chain** — Game state, moves, and scoring live on Linera (Views, contract, GraphQL service in WASM). No separate backend or database.
- **Microchains** — Each player has their own microchain; they interact via cross-chain messages.
- **Frontend** — React app that talks to Linera via GraphQL only (light blue and white theme).

See [ON_CHAIN_VERIFICATION.md](ON_CHAIN_VERIFICATION.md) for how on-chain behavior is verified.

## Project Structure

- **word-duel/** — Linera application (Rust): contract, service, state (Views). Builds to WASM.
- **client/** — React frontend: create/join room, play rounds, view result.
- **compose.yaml** — Docker Compose setup.
- **Dockerfile** — Image with Rust, Linera tooling, and Node.js.
- **run.bash** — Starts Linera network, builds and deploys the app, writes client `.env`, then runs the frontend.

## How to Run

**Prerequisites:** Docker and Docker Compose.

1. From the project root:
   ```bash
   docker compose up --build
   ```
2. Wait until you see an Application ID and “Compiled successfully!” (first run can take several minutes).
3. Open **http://localhost:5173** in your browser.

**Useful commands:**

- Stop: `docker compose down`
- Clean restart (clears Linera storage): `docker compose down` then `docker compose up --build`
- Logs: `docker compose logs -f app`

**Ports:** 5173 (web app), 8080 (faucet), 9001 (shard proxy), 13001 (shard).

## Playing a Match

1. Enter your name and click “Play with Friend.”
2. **To host:** Choose number of rounds, click “Create Room,” then share your Room ID (the chain ID shown).
3. **To join:** Enter the host’s Room ID and click “Join Room.”
4. In the room, use the displayed letters to type a word (min 3 letters) and click “Submit Word” when it’s your turn. After each round you’ll see both words and points; after all rounds you’ll see the final result (Win / Lose / Draw).

## License

This project is open source.
