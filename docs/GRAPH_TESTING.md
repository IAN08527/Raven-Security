# Backlog #4 — Graph Engine: How to Test

This session implemented the criminal-network graph engine (architecture §6.2, §9.2):
Rust `get_ego_graph` / `get_macro_graph` (Bolt + batched evidence hydrate), the
Cytoscape micro/macro UI, and the evidence side panel. It is proven end-to-end
against the live cloud Supabase.

## What was built
- **Rust (`raven-core/src/db/graph.rs`)** — canonical Postgres graph path:
  - `get_ego_graph` — recursive-CTE ego walk (N hops, weight floor).
  - `get_macro_graph` — top-N heaviest relationships of a case.
  - `edge_evidence` / `entity_details` / `list_entities` — side-panel reads.
  - ONE batched evidence hydrate per subgraph (never N+1, §6.2).
- **Rust (`raven-core/src/db/neo4j.rs`)** — Bolt traversal paths
  (`ego_subgraph`, `macro_edges`) used when Neo4j is reachable; falls back to
  Postgres on any error (D4 graceful degradation). The response reports
  `source: "neo4j" | "postgres"` so you can see which store answered.
- **Tauri commands** — `get_ego_graph`, `get_macro_graph`, `get_edge_evidence`,
  `get_entity_details`, `list_entities` (all emit audit best-effort).
- **Python engine (`engine/graph.py`)** — dev-mirror of the same SQL at
  `POST /graph/{macro,ego,edge_evidence,entity,entities}` so the UI runs in a
  plain browser without building the Rust shell.
- **Frontend** — `GraphPane` (micro/macro toggle, hops stepper, weight-floor
  slider, layout picker, entity search, legend, node shapes/colours by type,
  edge width/colour by weight/evidence kind) and `EvidencePane` (node + edge
  provenance). `useInvoke` auto-routes: Tauri → engine → embedded mock.
- **Demo data** — `tools/seed_graph_demo.py` seeded a 20-entity / 20-relation
  network for `OP-RAVEN-01` with §7.1 weights (recomputed via `recompute_weight`).

## Three ways to test

### 1) Headless Rust CLI (fastest, no GUI)
```powershell
cd tools/raven_graph_cli
$env:PATH = "C:\path\to\mingw\mingw64\bin;$env:PATH"   # GNU toolchain
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
cargo run -- --macro OP-RAVEN-01            # top-N edges
cargo run -- --ego <entity_uuid> 2 5        # 2-hop ego, floor 5
cargo run -- --edge <rel_uuid>              # edge evidence + source files
cargo run -- --entities OP-RAVEN-01         # entity picker
```
Expected: `--macro` → ~14 nodes / 16 edges, `source: "postgres"`; `--ego` of
Rakesh Sawant → ~9 nodes / 11 edges; `--edge` → relationship meta + evidence
snippets + source file.

### 2) Browser UI against live data (no Rust GUI build needed)
```powershell
# terminal A — start the Python engine (serves graph + NLP)
cd engine
python -m uvicorn main:app --host 127.0.0.1 --port 8756
# terminal B — start the Vite dev server
npm run dev
# open http://127.0.0.1:1420
```
The UI calls the engine's `/graph/*` endpoints. The bottom-right badge shows
`source: postgres` (or `mock` if the engine is down). Click **Macro** to see the
whole network, **Micro** + an entity to see its 2-hop ego, click any **edge** to
load its evidence in the right panel, use the search box to jump to a node.

### 3) Full Tauri app (production path, needs MSVC + Docker for Neo4j)
```powershell
npm run tauri dev
```
This uses the real Rust commands (Bolt when Neo4j is up). Start Neo4j first:
`docker compose -f infra/docker-compose.neo4j.yml up -d` — then the graph
responses will report `source: "neo4j"`.

## Notes / caveats
- The sandbox has **no Docker**, so the Neo4j Bolt path could not be exercised
  live here; it is implemented and falls back to Postgres (verified). On the
  demo machine with Neo4j up it will serve `source: "neo4j"`.
- If the engine is unreachable, the browser UI renders an **embedded mock
  network** (`src/dev/mockGraph.ts`) so the graph is always visible for
  rehearsal — the badge will read `source: mock`.
- Re-seed demo data any time: `python tools/seed_graph_demo.py` (idempotent).
