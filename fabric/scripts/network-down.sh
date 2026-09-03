#!/usr/bin/env bash
set -euo pipefail
: "${FABRIC_SAMPLES:?Set FABRIC_SAMPLES to your fabric-samples checkout}"
cd "$FABRIC_SAMPLES/test-network"
./network.sh down
