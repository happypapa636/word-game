FROM rust:1.86-slim

SHELL ["bash", "-c"]

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    protobuf-compiler \
    clang \
    make \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Linera services
RUN cargo install --locked linera-service@0.15.7 linera-storage-service@0.15.7

# Install Node.js via nvm
RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.40.3/install.sh | bash \
    && export NVM_DIR="$HOME/.nvm" \
    && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" \
    && nvm install lts/krypton \
    && nvm use lts/krypton \
    && nvm alias default lts/krypton

# Set up NVM in the environment
ENV NVM_DIR="$HOME/.nvm"
ENV PATH="$NVM_DIR/versions/node/lts/krypton/bin:$PATH"

WORKDIR /build

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5173 || exit 1

# Fix line endings (remove \r) and run script
ENTRYPOINT sed -i 's/\r$//' /build/run.bash && bash /build/run.bash
