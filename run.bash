#!/usr/bin/env bash

set -eu

echo ">>> Starting Linera network..."

# Always clear wallet so we get a fresh chain on every startup (avoids stale network references).
if [ -d "$HOME/.config/linera" ] || [ -f "$HOME/.config/linera/wallet.json" ]; then
  echo ">>> Clearing wallet for fresh start..."
  rm -rf "$HOME/.config/linera" 2>/dev/null || true
fi

# Clear any existing Linera network storage so we don't get
# "storage is already initialized" when re-running (e.g. after docker compose down/up).
# Storage can persist on the host via the .:/build volume mount, in the container's home,
# or in /tmp (e.g. .tmp* dirs from linera net helper).
for base in /build "$HOME"; do
  if [ -d "$base/.linera" ]; then
    echo ">>> Clearing existing Linera network storage ($base/.linera)..."
    rm -rf "$base/.linera" 2>/dev/null || true
  fi
  for d in "$base"/linera-*; do
    if [ -d "$d" ]; then
      echo ">>> Clearing existing Linera network storage ($d)..."
      rm -rf "$d" 2>/dev/null || true
    fi
  done
done
# Clear /tmp Linera dirs (helper may use e.g. /tmp/.tmpXXXX)
for tmpd in /tmp/.tmp* /tmp/linera*; do
  if [ -d "$tmpd" ]; then
    echo ">>> Clearing existing Linera temp storage ($tmpd)..."
    rm -rf "$tmpd" 2>/dev/null || true
  fi
done

# Exclude Cargo target dirs (linera-sdk-*, linera-views-* etc. are build artifacts)
for base in /build /tmp "$HOME"; do
  [ "$base" = "/" ] && continue
  while IFS= read -r -d '' d; do
    [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
  done < <(find "$base" -maxdepth 4 -type d -name "linera-*" -not -path "*/target/*" -print0 2>/dev/null || true)
done
while IFS= read -r -d '' d; do
  [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
done < <(find /tmp -maxdepth 2 -type d \( -name ".tmp*" -o -name "linera*" \) -print0 2>/dev/null || true)

# Get helper and clear its paths
eval "$(linera net helper)"
# Clear the path the helper just set (it may point to existing storage from a previous run)
for var in LINERA_NETWORK LINERA_NETWORK_DIR LINERA_STORAGE LINERA_NETWORK_STORAGE LINERA_NET; do
  if [ -n "${!var:-}" ]; then
    path="${!var}"
    path="${path#rocksdb:}"  # strip rocksdb: prefix if present
    if [ -f "$path" ]; then
      echo ">>> Clearing helper storage file ($path)..."
      rm -f "$path" 2>/dev/null || true
    fi
    if [ -d "$path" ]; then
      echo ">>> Clearing helper storage path ($path)..."
      rm -rf "$path" 2>/dev/null || true
    fi
  fi
done 2>/dev/null || true

# Second pass: clear again so any path created by eval is gone (exclude Cargo target)
for base in /build /tmp "$HOME"; do
  [ "$base" = "/" ] && continue
  while IFS= read -r -d '' d; do
    [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
  done < <(find "$base" -maxdepth 4 -type d -name "linera-*" -not -path "*/target/*" -print0 2>/dev/null || true)
done
while IFS= read -r -d '' d; do
  [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
done < <(find /tmp -maxdepth 2 -type d \( -name ".tmp*" -o -name "linera*" \) -print0 2>/dev/null || true)

# Unset helper vars so next eval gets a clean slate; then re-eval right before spawn
unset LINERA_NETWORK LINERA_NETWORK_DIR LINERA_STORAGE LINERA_NETWORK_STORAGE LINERA_NET 2>/dev/null || true
sleep 3
# Extra delay so volume/filesystem releases handles (helps on Windows)
sleep 2
eval "$(linera net helper)"

# Final cleanup pass immediately before net up: remove any linera-* or .linera
# under /build (volume) and $HOME, but exclude Cargo target (linera-sdk-* etc. are build artifacts).
for base in /build "$HOME"; do
  [ ! -d "$base" ] && continue
  while IFS= read -r -d '' d; do
    [ -n "$d" ] && [ -d "$d" ] && echo ">>> Removing existing storage: $d" && rm -rf "$d" 2>/dev/null || true
  done < <(find "$base" -maxdepth 8 -type d \( -name "linera-*" -o -name ".linera" \) -not -path "*/target/*" -print0 2>/dev/null || true)
done
# Also remove by literal pattern (top-level only: network dirs like /build/linera-2026-02-04T...)
for d in /build/linera-* /build/.linera "$HOME/linera-"* "$HOME/.linera"; do
  if [ -d "$d" ]; then
    echo ">>> Removing existing storage: $d"
    rm -rf "$d" 2>/dev/null || true
  fi
done

# Run net up in background so script never blocks (linera_spawn may wait forever for children).
# Poll log for READY! then continue; LINERA_* are already set from eval above.
: > /tmp/linera_net_up.log
linera_spawn linera net up --with-faucet >> /tmp/linera_net_up.log 2>&1 &
NET_PID=$!
READY_SEEN=0
for attempt in 1 2; do
  for i in {1..120}; do
    if grep -q "READY!" /tmp/linera_net_up.log 2>/dev/null; then
      READY_SEEN=1
      break
    fi
    sleep 1
  done
  if [ "$READY_SEEN" -eq 1 ]; then
    break
  fi
  if [ "$attempt" -eq 1 ] && grep -q "storage is already initialized" /tmp/linera_net_up.log 2>/dev/null; then
    echo ">>> Detected stale storage; clearing and retrying..."
    kill "$NET_PID" 2>/dev/null || true
    for base in /build "$HOME" /tmp; do
      [ ! -d "$base" ] && continue
      find "$base" -maxdepth 8 -type d -name "linera-*" -not -path "*/target/*" -exec rm -rf {} + 2>/dev/null || true
      find "$base" -maxdepth 8 -type d -name ".linera" -not -path "*/target/*" -exec rm -rf {} + 2>/dev/null || true
    done
    for d in /build/linera-* /build/.linera "$HOME/linera-"* "$HOME/.linera"; do
      [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
    done
    sleep 2
    eval "$(linera net helper)"
    export LINERA_WALLET LINERA_KEYSTORE LINERA_STORAGE
    : > /tmp/linera_net_up.log
    linera_spawn linera net up --with-faucet >> /tmp/linera_net_up.log 2>&1 &
    NET_PID=$!
  else
    echo ">>> Network did not become ready (no READY! in log)."
    cat /tmp/linera_net_up.log
    exit 1
  fi
done
if [ "$READY_SEEN" -ne 1 ]; then
  echo ">>> Network did not become ready after retry."
  cat /tmp/linera_net_up.log
  exit 1
fi
echo ">>> Network is up (READY! seen)."

# Wait for faucet to be ready (give it time to bind to 8080)
echo ">>> Waiting for faucet..."
sleep 15
for i in {1..60}; do
  if curl -s http://localhost:8080 > /dev/null 2>&1; then
    echo ">>> Faucet is ready!"
    break
  fi
  sleep 1
done

export LINERA_FAUCET_URL=http://localhost:8080

# Initialize wallet (we cleared it above for a fresh start)
echo ">>> Initializing wallet..."
linera wallet init --faucet="$LINERA_FAUCET_URL" || true

echo ">>> Requesting chain..."
set +e
CHAIN_OUTPUT=$(linera wallet request-chain --faucet="$LINERA_FAUCET_URL" 2>&1)
CHAIN_ID=$(echo "$CHAIN_OUTPUT" | grep -oE '[a-f0-9]{64}' | head -1)
set -e

# Wait for the new chain to propagate to the validator (avoids "Blobs not found")
echo ">>> Waiting for chain to propagate..."
sleep 15

echo ">>> Building Rust contract..."
cd /build/word-duel || exit 1
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build --release --target wasm32-unknown-unknown
cd /build || exit 1

# Wait so validator is ready for blob upload (avoids "Blobs not found" on first try)
echo ">>> Waiting for validator before publish..."
sleep 15

echo ">>> Publishing and creating application..."
LINERA_APPLICATION_ID=""
for attempt in 1 2 3 4 5; do
  # Linera CLI may exit 1 due to internal "xargs: kill" cleanup; treat success by presence of app ID in output
  PUBLISH_OUT=$(linera --wait-for-outgoing-messages \
    publish-and-create \
    /build/word-duel/target/wasm32-unknown-unknown/release/word_duel_contract.wasm \
    /build/word-duel/target/wasm32-unknown-unknown/release/word_duel_service.wasm 2>&1) || true
  LINERA_APPLICATION_ID=$(echo "$PUBLISH_OUT" | grep -oE '[a-f0-9]{64}(:[0-9]+)?' | tail -1)
  if [ -z "$LINERA_APPLICATION_ID" ]; then
    last_line=$(echo "$PUBLISH_OUT" | tail -1 | tr -d '\r\n' | sed 's/[^0-9a-fA-F:]//g')
    if echo "$last_line" | grep -qE '^[a-f0-9]{64}(:[0-9]+)?$'; then
      LINERA_APPLICATION_ID=$last_line
    fi
  fi
  if [ -n "$LINERA_APPLICATION_ID" ]; then
    echo ">>> Application published: $LINERA_APPLICATION_ID"
    break
  fi
  if echo "$PUBLISH_OUT" | grep -q "Blobs not found\|Failed to communicate\|ContractBytecode\|ServiceBytecode\|storage operation error\|No such file or directory"; then
    echo ">>> Publish attempt $attempt failed, retrying in 20s..."
    echo "$PUBLISH_OUT" | head -3
    sleep 20
    LINERA_APPLICATION_ID=""
  else
    echo ">>> Publish failed (no application ID in output):" >&2
    echo "$PUBLISH_OUT" | tail -20 >&2
    exit 1
  fi
done
if [ -z "$LINERA_APPLICATION_ID" ]; then
  echo ">>> Failed to publish application after 5 attempts" >&2
  exit 1
fi
LINERA_APPLICATION_ID=$(echo "$LINERA_APPLICATION_ID" | tr -d '\r\n' | sed 's/[^0-9a-fA-F:]//g')
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
echo "Chain ID: ${CHAIN_ID:-<not available>}"
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
