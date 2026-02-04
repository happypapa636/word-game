#!/usr/bin/env bash

set -eu

echo ">>> Starting Linera network..."

# Clear any existing Linera network storage so we don't get
# "storage is already initialized" when re-running (e.g. after docker compose down/up).
# Storage can persist on the host via the .:/build volume mount, in the container's home,
# or in /tmp (e.g. .tmp* dirs from linera net helper).
for base in /build "$HOME"; do
  if [ -d "$base/.linera" ]; then
    echo ">>> Clearing existing Linera network storage ($base/.linera)..."
    rm -rf "$base/.linera"
  fi
  for d in "$base"/linera-*; do
    if [ -d "$d" ]; then
      echo ">>> Clearing existing Linera network storage ($d)..."
      rm -rf "$d"
    fi
  done
done
# Clear /tmp Linera dirs (helper may use e.g. /tmp/.tmpXXXX)
for tmpd in /tmp/.tmp* /tmp/linera*; do
  if [ -d "$tmpd" ]; then
    echo ">>> Clearing existing Linera temp storage ($tmpd)..."
    rm -rf "$tmpd"
  fi
done
eval "$(linera net helper)"
# Clear the path the helper just set (it may point to existing storage from a previous run)
for var in LINERA_NETWORK LINERA_NETWORK_DIR LINERA_STORAGE LINERA_NETWORK_STORAGE LINERA_NET; do
  if [ -n "${!var:-}" ]; then
    path="${!var}"
    path="${path#rocksdb:}"  # strip rocksdb: prefix if present
    if [ -f "$path" ]; then
      path="$(dirname "$path")"
    fi
    if [ -d "$path" ]; then
      echo ">>> Clearing helper storage path ($path)..."
      rm -rf "$path"
    fi
  fi
done 2>/dev/null || true

linera_spawn linera net up --with-faucet

# Wait for faucet to be ready
echo ">>> Waiting for faucet to be ready..."
sleep 5
for i in {1..30}; do
  if curl -s http://localhost:8080 > /dev/null 2>&1; then
    echo ">>> Faucet is ready!"
    break
  fi
  echo ">>> Waiting for faucet... ($i/30)"
  sleep 1
done

export LINERA_FAUCET_URL=http://localhost:8080

# Initialize wallet if not already done
if [ ! -f ~/.config/linera/wallet.json ]; then
  echo ">>> Initializing wallet..."
  linera wallet init --faucet="$LINERA_FAUCET_URL" || true
fi

echo ">>> Requesting chain..."
linera wallet request-chain --faucet="$LINERA_FAUCET_URL" || true

echo ">>> Building Rust contract..."
cd /build/word-duel || exit 1
rustup target add wasm32-unknown-unknown || true
cargo build --release --target wasm32-unknown-unknown
cd /build || exit 1

echo ">>> Publishing and creating application..."
LINERA_APPLICATION_ID=$(linera --wait-for-outgoing-messages \
  publish-and-create \
  /build/word-duel/target/wasm32-unknown-unknown/release/word_duel_contract.wasm \
  /build/word-duel/target/wasm32-unknown-unknown/release/word_duel_service.wasm)
export REACT_APP_LINERA_APPLICATION_ID=$LINERA_APPLICATION_ID

# Display startup summary
echo ">>> Creating client .env file..."
cat > /build/client/.env <<EOF
REACT_APP_LINERA_APPLICATION_ID=$LINERA_APPLICATION_ID
REACT_APP_LINERA_FAUCET_URL=$LINERA_FAUCET_URL
EOF

echo ""
echo "========================================"
echo "Word Duel - On-Chain Game on Linera"
echo "========================================"
echo ""
echo "Linera Network: Running"
echo "Application ID: $LINERA_APPLICATION_ID"
echo "Faucet URL: $LINERA_FAUCET_URL"
echo "Frontend: http://localhost:5173"
echo ""
echo "Next Steps:"
echo "1. Open http://localhost:5173 in your browser"
echo "2. Create or join a match"
echo "3. Play Word Duel on-chain!"
echo "========================================"
echo ""

echo ">>> Installing frontend dependencies..."
cd /build/client || exit 1

# Load nvm and use Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Ensure Node.js is available (should already be installed in Dockerfile)
if ! command -v node &> /dev/null; then
  echo ">>> Node.js not found, installing..."
  nvm install lts/krypton
  nvm use lts/krypton
fi

# Verify Node.js version
NODE_VERSION=$(node --version || echo "unknown")
echo ">>> Using Node.js: $NODE_VERSION"

# Always run npm install to ensure all dependencies (including new ones) are installed
npm install

echo ">>> Starting frontend development server..."
echo ""
echo "========================================"
echo "Application is starting up!"
echo "========================================"
echo ""
echo "Frontend is compiling... Please wait for 'Compiled successfully!' message"
echo ""
echo "Once compiled, access the app at:"
echo "  http://localhost:5173"
echo ""
echo "To view logs: docker compose logs -f app"
echo "To stop: docker compose down"
echo "========================================"
echo ""
npm start
