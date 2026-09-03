# Running VAJRA on a real Hyperledger Fabric network

The gateway ships two interface-identical ledger drivers:

| `LEDGER_MODE` | What it is | Needs |
|---|---|---|
| `lite` (default) | The same chaincode logic executed in-process against a hash-chained block table in Postgres. Transaction ids and block numbers are real hashes. | Nothing |
| `fabric` | Hyperledger Fabric v2.x via the Fabric Gateway SDK | Docker + the `fabric-samples` test network |

`lite` exists so the product runs on any laptop — including one without Docker or WSL. It is a
development and fail-over driver, not a consensus network, and `/v1/health` says so out loud.

## Bringing up the real network

```bash
# 1. Prerequisites (Linux / macOS / WSL2 — Fabric's scripts are bash and need Docker)
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh && ./install-fabric.sh docker samples binary

# 2. Start a two-org network with a channel.
#    Org1 = the VAJRA platform, Org2 = the auditor. Two organisations endorsing the same
#    transactions is the story judges should see.
cd fabric-samples/test-network
./network.sh up createChannel -c vajrachannel -ca

# 3. Build and deploy the chaincode
cd <this repo>/chaincode/vajra-cc
pnpm install && pnpm build
cd <fabric-samples>/test-network
./network.sh deployCC -c vajrachannel -ccn vajra-cc -ccp <this repo>/chaincode/vajra-cc -ccl typescript

# 4. Point the gateway at it (paths come from fabric-samples/test-network/organizations/…)
LEDGER_MODE=fabric
FABRIC_CHANNEL=vajrachannel
FABRIC_CHAINCODE=vajra-cc
FABRIC_MSP_ID=Org1MSP
FABRIC_PEER_ENDPOINT=localhost:7051
FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_CERT_PATH=.../users/User1@org1.example.com/msp/signcerts/cert.pem
FABRIC_KEY_PATH=.../users/User1@org1.example.com/msp/keystore/<key>_sk
FABRIC_TLS_CERT_PATH=.../peers/peer0.org1.example.com/tls/ca.crt
```

Restart the gateway. `/v1/health` should report `ledger: fabric · vajrachannel/vajra-cc @ localhost:7051`.

## Proving it from the command line

```bash
peer chaincode query -C vajrachannel -n vajra-cc -c '{"Args":["AssetPassport:Get","CAD-TURBINE-V4"]}'
peer chaincode query -C vajrachannel -n vajra-cc -c '{"Args":["AssetPassport:GetHistory","CAD-TURBINE-V4"]}'
```

`GetHistory` is Fabric's own key history — the provenance tree, with no extra code.

## The fail-closed demo

```bash
docker stop peer0.org1.example.com     # then request a transfer in the console → DENIED, ledger_unavailable
docker start peer0.org1.example.com    # queued anchors drain by themselves
```

On a machine without Docker, the console's dashboard has the same switch (`Simulate a ledger outage`),
which drives the identical code path.

## Wallet material

Keep enrolled identities under `fabric/wallets/` — gitignored, never committed.
