#!/usr/bin/env bash
# Convenience wrapper: bring up a two-org Fabric network and deploy vajra-cc.
# Run from a machine with Docker (Linux, macOS, or WSL2). See fabric/README.md.
set -euo pipefail
: "${FABRIC_SAMPLES:?Set FABRIC_SAMPLES to your fabric-samples checkout}"
CHANNEL="${FABRIC_CHANNEL:-vajrachannel}"
CC_NAME="${FABRIC_CHAINCODE:-vajra-cc}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "→ building chaincode"
(cd "$REPO_ROOT/chaincode/vajra-cc" && pnpm install --frozen-lockfile && pnpm build)

echo "→ starting network on channel $CHANNEL"
cd "$FABRIC_SAMPLES/test-network"
./network.sh up createChannel -c "$CHANNEL" -ca

echo "→ deploying $CC_NAME"
./network.sh deployCC -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$REPO_ROOT/chaincode/vajra-cc" -ccl typescript

echo "→ done. Set LEDGER_MODE=fabric and the FABRIC_* paths in .env, then restart the gateway."
