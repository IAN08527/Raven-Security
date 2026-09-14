# Multi-org Fabric runbook (M5-T2, D22)

Three organisations with separate MSPs, one Raft orderer, channel
`ravenchannel`, chaincode `ravenledger`, endorsement policy
`AND('district-cid.member', 'cyber-cell.member')`.

| Org | MSP id | Peer |
|:---|:---|:---|
| district-cid | `district-cid` | `peer0.district-cid.raven.local:7051` |
| cyber-cell | `cyber-cell` | `peer0.cyber-cell.raven.local:8051` |
| records-bureau | `records-bureau` | `peer0.records-bureau.raven.local:9051` |
| orderer | `OrdererMSP` | `orderer.raven.local:7050` (Raft) |

Requires a running Docker daemon (the reference machine runs the mock
ledger instead; `LEDGER_MODE=mock` is the one-flag dev swap, D13).

## 1. Crypto and genesis block

```bash
cd infra/fabric
cryptogen generate --config=crypto-config.yaml --output=crypto-config
mkdir -p channel-artifacts
configtxgen -profile RavenOrdererGenesis -outputBlock ./channel-artifacts/genesis.block -channelID system-channel
configtxgen -profile RavenChannel -outputCreateChannelTx ./channel-artifacts/ravenchannel.tx -channelID ravenchannel
```

## 2. Start the network

```bash
docker compose up -d
```

## 3. Channel join (once per peer)

```bash
export CORE_PEER_LOCALMSPID=district-cid
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_MSPCONFIGPATH=$PWD/crypto-config/peerOrganizations/district-cid.raven.local/users/Admin@district-cid.raven.local/msp
peer channel create -o localhost:7050 -c ravenchannel -f ./channel-artifacts/ravenchannel.tx
peer channel join -b ravenchannel.block
# repeat join for cyber-cell (:8051) and records-bureau (:9051) with
# their MSP paths; anchor-peer updates per org follow the same pattern.
```

## 4. Chaincode deploy (policy enforced here)

```bash
peer lifecycle chaincode package ravenledger.tar.gz --path ../../ledger/chaincode --lang node --label ravenledger_1
peer lifecycle chaincode install ravenledger.tar.gz            # every peer
peer lifecycle chaincode approveformyorg -o localhost:7050 --channelID ravenchannel \
  --name ravenledger --version 1 --package-id <PKG_ID> --sequence 1 \
  --signature-policy "AND('district-cid.member','cyber-cell.member')"
peer lifecycle chaincode commit -o localhost:7050 --channelID ravenchannel \
  --name ravenledger --version 1 --sequence 1 \
  --signature-policy "AND('district-cid.member','cyber-cell.member')" \
  --peerAddresses localhost:7051 --peerAddresses localhost:8051
```

## 5. Point the gateway at Fabric

```bash
LEDGER_MODE=fabric FABRIC_CCP=$PWD/connection.json FABRIC_WALLET=$PWD/wallet \
  node ../../ledger/gateway/server.js   # :8801, mode fabric
```

`GET /health` then reports `mode: fabric` with the three orgs and the
policy. `GET /verify/{docId}` returns `endorsements[]` with at least
the two required org names; the UI renders those as green org chips
and renders `mode: mock` entries with the amber MOCK LEDGER badge (D22).

## Dev topology caveats (stated, not hidden)

- Single orderer and single peer per org: sufficient for endorsement
  semantics (two orgs must still sign), not for production
  availability. Production runs three orderers and two peers per org;
  the MSP layout and policy are unchanged.
- TLS is off in this profile (loopback/private-link deployment).
  Terminate TLS at the gateway when the ledger leaves the host.
