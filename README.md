# Project Raven

AI-powered Criminal Network Analysis System — native Windows desktop (Tauri v2) for the
SIH26189 problem statement (MHA / NCRB, Women Safety Division). See `docs/` for the PRD,
design system, and architecture.

## Layout

```
src/                 React + WebView2 frontend (Cytoscape, MapLibre, MJPEG vision)
src-tauri/           Rust core: file I/O, saga coordinator, Neo4j writer, audit emitter
engine/              Python intelligence engine (FastAPI sidecar, port 8756)
ledger/              Hyperledger Fabric chaincode + Express gateway (:8801) + mock Merkle fallback
infra/               Postgres migration, Neo4j compose, trimmed Supabase config
tools/               Synthetic data generator + golden-path seeder
assets/              PMTiles basemap, CCTV clips, synthetic data
docs/                PRD, design system, architecture
```

## Cold start order (mandatory, see architecture §2.2)

1. Docker Desktop up, WSL2 integration enabled. Cap WSL2 memory in `.wslconfig` (`memory=8GB`).
2. `supabase start` (uses `infra/supabase/config.toml`).
3. `docker compose -f infra/docker-compose.neo4j.yml up -d`, wait for Bolt healthcheck.
4. Fabric `./network.sh up createChannel -c ravenchannel -ca` then `deployCC`.
5. `cd ledger/gateway && LEDGER_MODE=fabric node server.js` (falls back to mock if Fabric is down).
6. Confirm `ollama list` shows `phi3:mini` and `gemma2:2b` pulled.
7. `npm install && npm run tauri dev` — the Rust core spawns the Python sidecar and blocks on the
   startup health gate (red/green board) pinging all five dependencies.

To build the Python sidecar binary: `cd engine && ./build_sidecar.ps1` (outputs
`src-tauri/binaries/raven-engine-x86_64-pc-windows-msvc.exe`).

## Track split (six people, four coding tracks — architecture §16.3)

- A: Infra + Ledger
- B: Rust core
- C: Python engine (x2)
- D: Frontend
- E: Data + pitch

## Key architectural decisions

D1–D14 are documented in `docs/architecture.md`. The most load-bearing for the demo:
D2 (VRAM residency mutex, build first), D4 (saga not 2PC), D6 (offline PMTiles basemap),
D9 (human-in-the-loop Re-ID lock-on), D13 (Fabric via REST gateway with mock fallback).
