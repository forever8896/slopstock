# Railway-buildable Seal key server (Open mode). Built remotely by Railway via
# `railway up` — clones MystenLabs/seal and compiles the `key-server` binary, so
# the build context here is tiny (just this Dockerfile + entrypoint).
#
# The server reads PORT from env (Railway injects it) and exposes /health.
# Runtime env (set as Railway variables):
#   MASTER_KEY            BLS master secret from `seal-cli genkey`   (SECRET)
#   KEY_SERVER_OBJECT_ID  the on-chain KeyServer id from registration
#   SEAL_KS_NETWORK       Mainnet (default) | Testnet
#   SEAL_KS_NODE_URL      optional custom Sui fullnode URL
FROM rust:1.90-bullseye AS builder
ARG SEAL_REF=main
RUN git clone --depth 1 --branch "${SEAL_REF}" https://github.com/MystenLabs/seal /work || \
    git clone --depth 1 https://github.com/MystenLabs/seal /work
WORKDIR /work
RUN cargo build --release --bin key-server --config net.git-fetch-with-cli=true \
    && cp target/release/key-server /work/key-server

FROM debian:bullseye-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /work/key-server /usr/local/bin/key-server
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 2024
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
