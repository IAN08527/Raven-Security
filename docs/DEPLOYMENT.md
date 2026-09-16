# Raven Deployment Runbook

Who this is for: a technically capable person — another team member or a
technical evaluator — who has not worked on the codebase and needs to
install Raven on a machine that is not the development laptop, get it
running, and keep it running through the campus pilot.

Deployment profile in this document: `all-in-one` (server, one engine
node, and client on one machine). This is the development profile and the
campus pilot profile (`ARCHITECTURE.md` §8, D20). The `split` profile
(server on one machine, engine nodes near cameras, clients per user) uses
the same images and the same environment variables with different host
names; it is not separately documented here because no split deployment
has been performed yet, and documenting untested steps as instructions
would be guessing.

Honesty note: several setup steps below are flagged as not yet
implemented or not yet wired. Those flags are load-bearing. Do not work
around a flag by improvising; file it and stop at that step.

---

## Prerequisites

### Hardware requirements

- **GPU (minimum):** NVIDIA RTX 4050 6GB or equivalent, compute capability
  8.9 or higher. This is the reference machine the project measures
  against (`STACK.md` §6, S1a: 16 cameras sustained at 10 FPS each, peak
  VRAM 143.4MB of the 6GB budget). Older or smaller GPUs are untested;
  whether the system runs usefully on them is unknown because no such
  measurement exists.
- **RAM:** 16GB recommended. The Supabase local stack (Postgres, GoTrue,
  PostgREST, Storage), Neo4j, the engine node, and the document lane all
  run on this machine in the all-in-one profile.
- **Storage:** 50GB free for models and data. Model weights live under
  `models/` (gitignored, pulled once and cached locally), the basemap
  extract is ~543MB under `infra/tiles/`, and ingested blobs accumulate
  on disk.
- **Cameras (pilot):** at least 4, with overlapping fields of view (see
  Camera setup and `PILOT_PROTOCOL.md`).

### Software

- **Docker Desktop with WSL2 backend (Windows)**, or **Docker Engine
  (Linux)**. Required for Postgres+pgvector, Neo4j, the ledger gateway,
  and the basemap file server.
- **Git.**
- **Rust toolchain, pinned via `rust-toolchain.toml`.** The file pins the
  `stable` channel with the `clippy` and `rustfmt` components. Install
  with `rustup`; the pinned file in the repo root is authoritative, and
  no separate version number is stated here because the file does not
  state one.
- **Node 20 LTS.** Required for the ledger gateway and chaincode
  (`STACK.md` §7). The compose file runs `node:20-alpine` for the mock
  ledger.
- **Python 3.11.** Both Python lanes pin `requires-python == 3.11.*`
  (`engine/pyproject.toml`, `docs-lane/pyproject.toml`).
  Note: Python 3.13 is not compatible with numpy==1.26.* (no cp313
  wheels). Python 3.11 is required. Install side-by-side if 3.13 is
  already present and use py -3.11 for all engine and docs-lane
  commands.
- **CUDA 12.x driver.** The verified combination on the reference machine
  is NVIDIA driver 560.76 with CUDA runtime 12.6, torch 2.8.0+cu126,
  TensorRT 11.3.0.99 (`STACK.md` §6). Install the PyTorch cu126 wheels
  (`pip install torch torchvision --index-url
  https://download.pytorch.org/whl/cu126`) and `pip install
  tensorrt-cu12` — plain `pip install tensorrt` resolves to the CUDA 13
  variant and fails on this setup. Verify with the five checks in
  `STACK.md` §6 before proceeding; a half-working GPU stack produces
  confusing failures three layers up.

### Network

- Premises LAN only. No internet is required after initial setup, and no
  internet is used at runtime: there are no hosted model APIs, no map
  tile servers, no telemetry, and no CDN fonts (rule 6, enforced by
  `eval/test_no_egress.py`, which must pass).
- Internet **is** required once, during setup, for: cloning the repo,
  pulling Docker images, installing packages, downloading model weights,
  and fetching the PMTiles planet build and the OpenMapTiles fonts. After
  that the machine can be taken offline.

---

## First-time setup

### 1. Clone the repository

```bash
git clone <repo-url> raven
cd raven
```

### 2. Copy environment files

There is one committed `.env` template in the repository:
`engine/.env.example` (the engine node's service-account token, no
secrets inside — copy it to `engine/.env`, gitignored, and fill in the
value locally; step 9). Every other variable below is read directly
from the process environment with the defaults stated. The only other
committed environment file is `client/.env.development` (basemap URLs
for local development).

Two files are needed:

- **Repo / service environment** (consumed by the server, engine node,
  and ledger gateway wherever they run — export these in your shell, a
  systemd unit, or a `server/.env` / process manager of your choice; no
  loader is committed, so document whichever mechanism you use on the
  pilot machine):
- **`client/.env.development`** (already committed; override per machine
  as needed).

| Variable | Used by | Must be set manually, or has a default | Default if unset | What it does |
|:---|:---|:---|:---|:---|
| `DATABASE_URL` | Server health gate (`server/src/startup.rs`) | Has a default; set manually in split deployments | `postgres://postgres:postgres@localhost:5432/postgres` | Postgres connection string the server checks and uses |
| `NEO4J_URI` | Server health gate | Has a default; set manually in split deployments | `bolt://localhost:7687` | Neo4j Bolt endpoint |
| `NEO4J_USER` | Server health gate | Has a default | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | Server health gate | Has a default; **must** match the compose value below | `ravenpassword` | Neo4j password; must equal `NEO4J_AUTH` password in `infra/compose/all-in-one.yml` |
| `LEDGER_GATEWAY_URL` | Server ledger client (`server/src/ledger/mod.rs`) | Has a default | `http://127.0.0.1:8801` | Ledger gateway base URL for anchors and actions |
| `LEDGER_HEALTH_URL` | Server health gate | Has a default | `http://localhost:8801/health` | Ledger health endpoint the gate probes |
| `SUPABASE_URL` | Server auth (`server/src/auth.rs`, GoTrue JWKS) | Has a default; set manually if Supabase API is not on loopback | `http://127.0.0.1:54321` | Supabase API URL; JWKS is fetched from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (loopback, not egress) |
| `SAGA_DATABASE_URL` | Server ingest saga worker (`server/src/db/mod.rs`, D33) | **Must be set manually** where the saga runs; no code default | `postgresql://raven_saga:saga_password@localhost:54322/postgres` (local) | Postgres connection for the ingest saga background worker. Uses the raven_saga role (D33), not the service-role key |
| `POSTGRES_USER` | Compose `postgres` service | Must be set in compose (already set in the committed file) | `postgres` (in `infra/compose/all-in-one.yml`) | Postgres role for the deployment-shaped database |
| `POSTGRES_PASSWORD` | Compose `postgres` service | Must be set in compose (already set); change for any non-local deployment | `postgres` | Postgres password; `DATABASE_URL` must carry the same value |
| `POSTGRES_DB` | Compose `postgres` service | Has a default in compose | `postgres` | Postgres database name |
| `NEO4J_AUTH` | Compose `neo4j` service | Must be set in compose (already set) | `neo4j/ravenpassword` | Neo4j credentials; the password half must equal `NEO4J_PASSWORD` |
| `RAVEN_DETECTOR_PATH` | Engine node (`engine/main.py`) | Has a default | `yolov8n.pt` | Detector weights path used by calibration |
| `RAVEN_SERVER_URL` | Engine node | Has a default; set manually in split deployments | `http://server:8443` | Server URL the engine node registers with (`POST /v1/nodes`) |
| `RAVEN_NODE_NAME` | Engine node | Has a default | `engine-node-1` | Node name; re-posting with the same name updates the row rather than duplicating it |
| `RAVEN_NODE_ADDRESS` | Engine node | Has a default | `https://localhost:8756` | Node address reported to the server |
| `RAVEN_ENGINE_TOKEN` | Engine node (`engine/main.py`) | **Must be set manually** (copy `engine/.env.example` to `engine/.env`, gitignored); no default | unset (registration is refused without it) | Service-account admin JWT the engine presents as a Bearer credential on `POST /v1/nodes` (step 9); never commit or log the value |
| `LEDGER_MODE` | Ledger gateway (`ledger/gateway/server.js`) | Has a default; **the pilot runs the mock only until Fabric is stood up** | `mock` | `mock` = in-process log; `fabric` = multi-org network in `infra/fabric/` |
| `LEDGER_GATEWAY_PORT` | Ledger gateway | Has a default | `8801` | Port the gateway listens on |
| `LEDGER_MOCK_PORT` | Standalone mock (`ledger/mock/index.js`) | Has a default | `8801` | Port for the standalone mock twin (the compose file runs the mock, not this twin) |
| `LEDGER_CHANNEL` | Ledger gateway (fabric mode) | Has a default | `ravenchannel` | Fabric channel name |
| `LEDGER_CHAINCODE` | Ledger gateway (fabric mode) | Has a default | `ravenledger` | Fabric chaincode name |
| `FABRIC_CCP` | Ledger gateway (fabric mode) | **Must be set manually in fabric mode** | `./connection.json` | Path to the Fabric connection profile |
| `FABRIC_WALLET` | Ledger gateway (fabric mode) | **Must be set manually in fabric mode** | `./wallet` | Path to the Fabric file-system wallet |
| `LEDGER_IDENTITY` | Ledger gateway (fabric mode) | Has a default | `gateway-admin` | Fabric identity used for gateway connections |
| `FABRIC_AS_LOCALHOST` | Ledger gateway (fabric mode) | Has a default | unset (discovery `asLocalhost` on) | Set to `0` when peers are not on localhost |
| `VITE_BASEMAP_URL` | Client (committed in `client/.env.development`) | Has a committed default for local dev | `http://localhost:8802/maharashtra.pmtiles` | PMTiles archive the MapLibre client reads with byte-range GETs |
| `VITE_BASEMAP_URL_BASE` | Client (committed) | Has a committed default | `http://localhost:8802` | Basemap host (glyphs are served from `<base>/glyphs/`) |
| `VITE_BASEMAP_ATTRIBUTION` | Client (committed) | Has a committed value; **must stay visible** | `© OpenStreetMap contributors (ODbL)` | ODbL attribution rendered by the map layer |
| `RAVEN_BLOB_DIR` | Server upload handler / blob store (`server/src/storage.rs`, D34) | Has a default | `./blobs` | Directory for content-addressed blob storage. Create before starting the server. Must be on a disk with sufficient space for ingested documents |
| `DOCS_LANE_URL` | Server saga docs-lane client | Has a default | `http://localhost:8757` | Internal docs-lane service URL. The docs-lane HTTP service is not yet implemented; this URL will be used when it is |

What is unknown here and why: there is no committed loader (no
`dotenv` wiring, no `server/.env.example`) as of this writing, so the
mechanism for getting these into each process on the pilot machine
(shell exports, systemd `EnvironmentFile`, compose `env_file`) is the
deployer's choice and must be written down on that machine. When a
template is committed, this section should point at it instead of
repeating the table.

### 3. Download model weights

Intended interface:

```bash
cargo xtask download-models
```

**This command does not exist yet — flagged, not implemented.** The only
subcommand `cargo xtask` accepts as of this writing is `generate-types`
(verified in `xtask/src/main.rs`; anything else prints usage and exits).
Do not invent flags for it. Until it is implemented, perform the manual
steps below, which are the current real procedure.

Manual steps (current, real):

1. Create the directory: `models/` is gitignored (only `models/.gitkeep`
   is tracked); contents are pulled once and cached locally, never
   committed.
2. Download `yolov8n.pt` (Ultralytics) into `models/`. The S1a runs used
   weights pulled once and cached locally per `STACK.md` §5.
3. Export the detector to TensorRT FP16 per `STACK.md` §6 (the S1a
   throughput rows were measured with a real TensorRT FP16 detector;
   the exact export command for this machine is not recorded in the
   repo, so record the command you use alongside the resulting
   `.engine` file name and size).
4. Download the OSNet weights into `models/`: `osnet_x1_0.pth`
   (10,994,685 bytes) and `osnet_x0_25.pth` (3,057,863 bytes), MSMT17
   same-domain checkpoints from the torchreid model zoo, with
   `models/osnet_x1_0.engine` (9,905,548 bytes) as the exported TensorRT
   reference build (`RESULTS.md` S2 rows, 2026-09-15; `STACK.md` §6 OSNet
   engine record). Verify with `torch.load` strict (567/567 keys) rather
   than by filename.
5. Confirm nothing in `models/` is committed (`git status` must show no
   `*.pt`, `*.onnx`, or `*.engine` staged — the `.gitignore` covers
   these, but check anyway).

### 4. Provision the PMTiles basemap

The client reads a local extract with the pmtiles.js protocol
(byte-range GETs against the raw file served by nginx on :8802). The
`pmtiles serve` command is explicitly **not** used (it does not serve
raw archives; see `infra/compose/basemap/nginx.conf`).

The measured extract (`RESULTS.md` tiles-audit row, 2026-09-14):

- Source planet build: `build.protomaps.com/20260206.pmtiles`
- Bounding box (Maharashtra): `72.6,15.6,80.9,22.04`
- Output: `infra/tiles/maharashtra.pmtiles` (543MB, 626,688 tiles,
  zooms 0–15, verify passes)
- Licence: ODbL; the client must keep rendering the attribution string
  from `VITE_BASEMAP_ATTRIBUTION`.

Provision it (one-time, needs internet):

```bash
# Download the planet build once (large file; keep it outside the repo).
# Then cut the Maharashtra extract into the path nginx serves:
pmtiles extract <planet-file>.pmtiles infra/tiles/maharashtra.pmtiles \
  --bbox=72.6,15.6,80.9,22.04
pmtiles verify infra/tiles/maharashtra.pmtiles
```

What is unknown and why: the exact planet filename and the `pmtiles`
binary version used for the recorded extract are not stated in
`RESULTS.md` beyond the `20260206` build tag, so re-provisioning
produces a byte-different but functionally equivalent file. That is
fine — re-record the resulting size and tile count next to this step on
the pilot machine rather than expecting the bytes to match.

`infra/tiles/*` is gitignored (only `.gitkeep` is tracked), so the
extract is never committed.

### 5. Provision fonts

MapLibre must never request font glyphs from a third party (rule 6).
Fonts are served locally from the same nginx host (`/glyphs/`).

The measured set (`RESULTS.md` tiles-audit row, 2026-09-15):

- Source: `github.com/openmaptiles/fonts` v2.0
- Files: Noto Sans Regular + Bold PBF stacks under
  `infra/tiles/glyphs/` (served at `http://localhost:8802/glyphs/`)
- Licence: Apache 2.0; the text file `infra/tiles/glyphs/FONTS_LICENCE`
  is tracked in git and must stay with the fonts.

Provision them (one-time, needs internet): download the OpenMapTiles
fonts v2.0 release, unpack the `Noto Sans Regular` and `Noto Sans Bold`
PBF directories into `infra/tiles/glyphs/`, and confirm
`FONTS_LICENCE` is present. The per-range `.pbf` files stay gitignored;
only `FONTS_LICENCE` is committed (see `.gitignore` — git cannot
re-include files inside an excluded directory without the explicit
un-exclusion already in place, so do not restructure these paths).

Verify: `GET http://127.0.0.1:8802/glyphs/Noto%20Sans%20Regular/0-255.pbf`
(or any range present on disk) returns 200 with content type
`application/x-protobuf`.

### 6. Start services

```bash
docker compose -f infra/compose/all-in-one.yml up -d
```

This brings up four containers: `raven-postgres` (:5432),
`raven-neo4j` (:7474/:7687), `raven-ledger-mock` (:8801), and
`raven-basemap` (:8802). It does **not** start the Rust server, the
engine node, the document lane, or the client — those run next.

Two honest caveats, both stated in the compose file header rather than
hidden:

- The compose Postgres is the plain `pgvector/pgvector:pg17` image, not
  the Supabase-flavoured image `supabase start` uses. Wiring this
  Postgres to the full application schema (GoTrue auth + RLS) is a
  follow-up, not decided. For the pilot, the schema path is
  `supabase start` / `supabase db reset` (next step) against the
  Supabase local Postgres on :54322; the compose Postgres is the
  deployment-shaped database. Do not assume they are interchangeable —
  confirm on the pilot machine which Postgres the server's
  `DATABASE_URL` points at and write it down.
- TLS with mutual authentication on all inter-service traffic is
  required even in development (`ARCHITECTURE.md` §1.1) and is **not
  implemented** in this compose file — everything is plain HTTP/Bolt on
  a trusted local network. Flagged since M0-T8, not fixed. The pilot
  runs on a trusted premises LAN only; do not expose these ports
  beyond it.

### 7. Apply database migrations

```bash
supabase start    # Postgres 54322, Studio 54323
supabase db reset # replays all migrations in supabase/migrations/, destroys data
```

`supabase db reset` replays the baseline
(`20260910000000_baseline.sql`) plus all additive migrations (D28
insight_reviews tightening, Re-ID threshold constraints, extraction
spans/provenance, search indexes, location–camera link). A clean reset
is verified by `eval/test_rls.py` (81/81 green, `RESULTS.md` M0-T4-rls
rows). Migrations are additive after the baseline: never edit an
applied migration; add a new one with `supabase migration new <name>`.

### 8. Create the first admin user

There is no first-run wizard and no committed seed user. The `profiles`
table is keyed to GoTrue (`profiles.id REFERENCES auth.users(id) ON
DELETE CASCADE`), so two steps are required, in order. Run these
against the Supabase local database from step 7.

**Step A — create the `auth.users` entry through the GoTrue admin API.**
Production creates the auth user through GoTrue, not by inserting into
`auth.users` by hand (the server's own admin routes record the same
follow-up: the in-memory directory records intent until the GoTrue
wiring lands). With Supabase local running (API on :54321 per
`SUPABASE_URL` default), create the user with the GoTrue admin
endpoint using the service-role key from `supabase status`, then read
back the returned user `id` (a UUID). The exact key is machine-local —
run `supabase status` on the pilot machine and use the printed
`service_role` key; it is not recorded here because it differs per
install.

**Step B — insert the matching `profiles` row.** The baseline schema
(`supabase/migrations/20260910000000_baseline.sql`) defines:

```sql
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_no      text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  role          app_role NOT NULL,   -- 'io' | 'analyst' | 'auditor' | 'admin'
  ledger_id     text UNIQUE,         -- Fabric MSP identity, D22
  org_unit      text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Insert the admin row with the UUID from Step A:

```sql
INSERT INTO profiles (id, badge_no, full_name, role, org_unit)
VALUES ('<uuid-from-step-A>', '<badge-no>', '<full-name>', 'admin', '<org-unit>');
```

Replace the three bracketed values with the real badge number, name,
and org unit. Leave `ledger_id` NULL until Fabric identities are
issued (D22); the server treats a missing entry as
`skipped_no_identity`, never as a silent skip.

Verify: `SELECT id, badge_no, full_name, role, active FROM profiles;`
shows the new admin with `role = admin` and `active = true`. Then sign
in through GoTrue as that user and confirm `GET /admin/users` (admin
role only) returns 200.

What is unknown and why: the server process currently carries its user
directory in memory (`UsersStore`/`ProfilesStore` in
`server/src/auth.rs`) until per-request Postgres wiring lands, so a
`profiles` row alone does not yet confer API rights on a fresh server
boot — the admin must also exist in the running server's directory
(via `POST /admin/users` once an initial credential path is
established on that machine). This is a real gap, not a documentation
gap: confirm the exact first-login path on the pilot machine and write
it down there rather than following this section blindly.

### 9. Create engine node service account

`POST /v1/nodes` requires a verified admin JWT
(`server/src/api/nodes.rs`: 401 without a token, 403 for a non-admin
identity), so the engine node registers with a dedicated service
account — a machine identity for the engine process, not any operator's
personal token. Without it the node logs `RAVEN_ENGINE_TOKEN not set`
(or `Engine token rejected by server`) and reports `registered: false`;
calibration numbers are still returned, but no tracking session is
possible until registration succeeds.

**Step A — create the service user through the GoTrue admin API.**
With Supabase local running (API on :54321), using the `service_role`
key from `supabase status` (machine-local, never committed):

```bash
curl -X POST http://localhost:54321/auth/v1/admin/users \
  -H "apikey: <service_role>" \
  -H "Authorization: Bearer <service_role>" \
  -H "Content-Type: application/json" \
  -d '{"email":"engine-node-01@raven.local","password":"<long-random-password>",
       "email_confirm":true,
       "app_metadata":{"app_role":"admin"},
       "user_metadata":{"app_role":"admin"}}'
```

Set the role in both metadata objects: the server reads
`app_metadata.app_role` first and falls back to
`user_metadata.app_role` (`server/src/auth.rs`), so either path
resolves to `admin`. Read back the returned user `id`. There is no
GoTrue endpoint that mints a token directly for a user id — the token
comes from signing in as this account (Step B), which is the standard
GoTrue password-grant flow, not an admin shortcut.

**Step B — sign in as the service account to get its token.**

```bash
curl -X POST "http://localhost:54321/auth/v1/token?grant_type=password" \
  -H "apikey: <anon-key-from-supabase-status>" \
  -H "Content-Type: application/json" \
  -d '{"email":"engine-node-01@raven.local","password":"<same-password>"}'
```

The response's `access_token` is the value for `RAVEN_ENGINE_TOKEN`.
It is an ordinary GoTrue access token: it expires after `jwt_expiry`
(`supabase/config.toml`, 3600 seconds by default, maximum 604800 = one
week). For the pilot, consider setting `jwt_expiry = 604800` so the
engine credential rotates weekly rather than hourly — a configuration
choice, recorded on the pilot machine, not a code change. Refresh is
re-signing in (this step again), updating the value, and restarting the
engine node.

**Step C — record the service account in the server's directory.**
Like every admin user in step 8, the service account must also exist in
the running server's in-memory directory (`POST /admin/users` with
`badge_no` `ENGINE-NODE-01`, role `admin`, full name `Engine Node
Service Account`) until per-request Postgres wiring lands — a `profiles`
row or GoTrue user alone does not yet confer API rights on a fresh
server boot.

**Step D — write `engine/.env` and export it.** Copy
`engine/.env.example` to `engine/.env` (gitignored — never commit the
value) and fill in:

```bash
RAVEN_SERVER_URL=http://localhost:8443
RAVEN_ENGINE_TOKEN=<access-token-from-step-B>
```

The URL is `http`, not `https`, for the all-in-one loopback: TLS on
inter-service traffic is required by design but unimplemented in the
current tree (see Health verification caveats and
`SECURITY_AND_PRIVACY.md` §5) — change the scheme when TLS lands. In
split deployments set this to the server's reachable address. The
engine reads its process environment directly (no dotenv loader is
committed), so export these into the engine process however the pilot
machine manages it (shell export, systemd `EnvironmentFile`, or
equivalent) and treat the token as a secret everywhere: never commit
it, never log it (the engine never logs the value, not even partially).

**Step E — restart the engine node and verify.** Confirm `Engine node
registered: <node_id>` in the engine log and the node `ready` in `GET
/nodes` on the server. `registered: false` with `Engine token rejected
by server` means the token is missing, expired, or not an admin token —
re-do Step B (tokens expire hourly on the default `jwt_expiry`).

### 10. Run the GPU calibration check

Specified command:

```bash
python engine/scheduler.py --calibrate
```

**Flag: the `--calibrate` CLI flag does not exist in the tree as of
this writing.** `engine/scheduler.py` exposes the library function
`calibrate(detector_path, input_resolution, duration_s=10.0,
calibration_batch=4)` and the `FrameScheduler` class; there is no
`argparse` entry point, so running the file with `--calibrate` exits
without calibrating. The live calibration path is `POST /calibrate` on
the engine node (`engine/main.py`), which runs the same ten-second
batched detector forward pass and returns the result plus whether
server registration succeeded. Until the CLI exists, calibrate through
the engine node:

```bash
# With the engine node running (see step 10 context):
curl -X POST http://localhost:8756/calibrate
```

Expected output (a pass looks like this — field names from
`engine/main.py CalibrateResponse` and
`engine/scheduler.py CalibrationResult`):

```json
{
  "budget_dps": 193.04,
  "vram_ceiling": ្រាប់,
  "max_batch": 16,
  "gpu_name": "NVIDIA GeForce RTX 4050 Laptop GPU",
  "registered": true
}
```

Concretely: `budget_dps` is sustained detector frames per second over
the ten-second window (the S1a reference value on the RTX 4050 was
~193 detection-FPS at 16 cameras' load); `vram_ceiling` is allocatable
bytes after the 512MB headroom reserve; `max_batch` is the largest
batch fitting that ceiling; `gpu_name` is the CUDA device name;
`registered` reports whether the node's own `POST /v1/nodes` to the
server succeeded. A pass is: the call returns 200, `budget_dps` is a
positive number consistent within tolerance across two runs on the
same machine, measured VRAM matches `nvidia-smi` within tolerance, and
`registered` is `true`.

A node whose `budget_dps` lands below `10.0`
(`DEGRADED_BUDGET_DPS_FLOOR` in `engine/scheduler.py`) registers as
`degraded` and is assigned no cameras. That is not a failure to retry
past — it is the system refusing hardware it cannot do honest work on.
A node that fails calibration entirely (no CUDA device) raises rather
than returning a number; fix the GPU stack (`STACK.md` §6 checks)
before proceeding.

(The `vram_ceiling` value above is shown schematically: the real number
is bytes of headroom on the pilot machine and cannot be stated here
without measuring that machine.)

### 11. Open the client: how to build and launch the Tauri desktop app

```bash
cd client
npm install
npm run build   # tsc --noEmit + vite build; must be clean
```

`npm run build` runs `tsc --noEmit && vite build` (`client/package.json`).
TypeScript is `strict: true`; API boundary types are generated, not
hand-written — after changing any server API struct, run `cargo xtask
generate-types` first (D30; the command exists since 2026-09-15, output
under `client/src/types/generated/`, gitignored).

Then launch:

```bash
npm run tauri dev    # development shell with hot reload
# or: npm run tauri build  # produces the raven.exe bundle (one per user, D20)
```

The client talks to the server at `https://{server}:8443/v1` (REST +
WebSocket; the Rust core holds the session token, the WebView never
sees credentials) and to engine nodes directly for video (MJPEG
`<img>` + WebSocket overlays). Video never proxies through the server.

---

## Health verification

### `GET /v1/health` expected response

No authentication. Safe to expose on the LAN (`API_CONTRACTS.md`
§2.8). The server checks every dependency live on each call (not a
frozen snapshot) with a 3-second per-dependency timeout
(`server/src/startup.rs`).

```bash
curl http://localhost:8443/v1/health
```

All services up:

```json
{
  "dependencies": [
    { "name": "postgres", "healthy": true, "detail": "ok" },
    { "name": "neo4j",    "healthy": true, "detail": "ok" },
    { "name": "ledger",    "healthy": true, "detail": "ok" }
  ]
}
```

`all_healthy` is true only when every row is green. The server blocks
startup on a red row unless passed `--force` — and `--force` is for
diagnosing, not for running the pilot on.

### What each service's healthy state looks like

- **Postgres+pgvector:** `healthy: true, detail: "ok"` means a connect
  plus `SELECT 1` succeeded against `DATABASE_URL`. Confirm pgvector
  separately: `SELECT extversion FROM pg_extension WHERE
  extname='vector';` must return 0.5 or later (verified 0.8.2 against
  the local image, 0.8.6 in compose).
- **Neo4j:** `healthy: true` means a Bolt connect with `NEO4J_URI` /
  `NEO4J_USER` / `NEO4J_PASSWORD` plus `RETURN 1` succeeded.
  Browser/HTTP on :7474 is a secondary check, not the gate.
- **Ledger gateway:** `healthy: true` means `GET` on
  `LEDGER_HEALTH_URL` returned 2xx. Then check the mode directly:
  `curl http://localhost:8801/health` returns `{mode, orgs[], peers[]}`
  — `mode: "mock"` (single `mock` org) or `mode: "fabric"` (three orgs
  plus policy). The pilot runs `mock` until Fabric is stood up (see
  failure mode below); the UI must render mock endorsements with the
  amber MOCK LEDGER badge, never as real org signatures (D22).
- **Basemap (:8802):** not part of the server health gate (it is a
  client-side dependency). Check it directly: `GET
  http://127.0.0.1:8802/maharashtra` must return 200 (exact-match alias
  for the healthcheck), and a glyph range such as
  `/glyphs/Noto%20Sans%20Regular/0-255.pbf` must return 200 as
  `application/x-protobuf`.
- **Engine node:** `GET /nodes` on the server lists registered nodes
  with `budget_dps`, `gpu_name`, camera count, and last-seen. A node
  that calibrated below the floor shows `degraded` and holds no
  cameras.

### Common failure modes and how to diagnose them

- **Neo4j not connecting.** `GET /v1/health` shows `neo4j: healthy false`
  with the driver error or a 3-second timeout. Check: container running
  (`docker ps | grep raven-neo4j`), Bolt on :7687 reachable, and
  `NEO4J_PASSWORD` matching the compose `NEO4J_AUTH` password half.
  Killing Neo4j must turn exactly one row red and crash nothing (M0-T8
  acceptance) — if anything else goes red, the problem is elsewhere.
- **Fabric ledger in mock mode vs real mode.** `GET
  http://localhost:8801/health` answers the question directly: `mode:
  "mock"` with `orgs: ["mock"]` is the one-flag dev swap (D13), never
  the demonstrated configuration (D22). Real mode requires
  `LEDGER_MODE=fabric` plus `FABRIC_CCP`, `FABRIC_WALLET`, and the
  `fabric-network` SDK installed in `ledger/gateway`, with the network
  from `infra/fabric/README.md` up (crypto, channel, chaincode with the
  `AND('district-cid.member','cyber-cell.member')` policy). A
  fabric-mode gateway without the SDK or with unreachable peers fails
  loud with `LEDGER_UNAVAILABLE` — it never quietly falls back to mock.
  If `GET /verify/{docId}` shows endorsements with `mode: "mock"`,
  treat every "verified" badge in the UI as development-only.
- **Engine node not registering.** `POST /calibrate` returns
  `registered: false` when the node's own `POST /v1/nodes` failed, but
  the calibration numbers in the same response are still real — a
  server outage must not hide a real measurement (API_CONTRACTS §4).
  Check `RAVEN_SERVER_URL` (default `http://server:8443` is the split
  hostname, not loopback — set it to the server's reachable address),
  then `RAVEN_ENGINE_TOKEN`: unset logs `RAVEN_ENGINE_TOKEN not set`,
  a 401 (`Engine token rejected by server`) means the token is missing,
  expired (hourly on the default `jwt_expiry` — re-sign in per step 9),
  or not an admin token, and a 403 (`Engine token lacks admin role`)
  means the service account's role is not `admin`. Then check the
  server is up and `GET /nodes` on the server.
- **GPU not detected (falls back to CPU, what that means).** There is
  no silent CPU fallback in the calibration path: `calibrate()` raises
  `RuntimeError("calibrate() requires a CUDA device")` when CUDA is
  absent. Decode *can* fall back to software (PyAV without `h264_cuvid`
  / `hevc_cuvid`), which the M1-T2 acceptance calls out explicitly —
  verify hardware decode with `python -c "import av;
  print(av.codecs_available)"` and confirm the `*_cuvid` entries are
  present (`STACK.md` §6). If decode runs on CPU, per-camera FPS drops
  and the scheduler degrades all feeds uniformly; the per-feed
  effective-FPS readout shows it. Do not run the pilot on software
  decode without recording that fact next to the S1b numbers — it
  changes what the numbers mean.

---

## Camera setup

### How to register a camera via the admin UI

Camera registration is an **admin-only** action (`POST /cameras`
requires the `admin` role; the request without a bearer admin token is
401/403, and bad bodies are 422 with code `VALIDATION_FAILED`).
Reading the list (`GET /cameras`) needs no authentication (D32).

In the admin UI: open camera administration, add a camera with its code
(for example `cam_01`), label, feed URI (RTSP URL or file path), mode
(`live` or `recorded`), frame rate, and the declared start time (next
paragraph). Each successful registration writes one `camera.register`
audit row scoped to the platform nil-UUID case before returning
(API_CONTRACTS rule 6) — if the camera appears but no audit row
exists, treat the registration as suspect and re-verify.

Equivalent API call:

```bash
curl -X POST https://<server>:8443/v1/cameras \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"cam_01","label":"Gate","feed_uri":"rtsp://…",
       "mode":"live","declared_start_ts":"2026-10-04T09:00:00.000Z","fps":10}'
```

### `declared_start_ts` requirement and what happens if it is wrong

`declared_start_ts` is **required with no default** (D16, enforced in
`server/src/api/cameras.rs`: a missing value is rejected with
`declared_start_ts is required`). Every downstream timestamp is
`declared_start_ts + frame offset` — the case clock — and nothing
downstream reads system time (rule 3).

If it is wrong, **every cross-camera inference is silently corrupted**:
sightings land at the wrong case-clock times, topology arrival windows
compute against wrong elapsed times, and candidates clear or miss
thresholds for the wrong reasons — with no error anywhere, because all
the arithmetic is self-consistent around the wrong anchor. This is a
silent failure surface (`ARCHITECTURE.md` §10), mitigated by making the
field required and always visible on every feed, not solved. For
recorded files, set `declared_start_ts` to the actual recording start
time before ingestion. Mixing live and recorded sources in one session
is allowed only when declared times cohere; the system warns when they
do not.

### How to add topology edges between cameras

Topology edges (`LEADS_TO` with travel-time statistics) modulate the
match threshold; they never gate execution (D15). Adding an edge is
admin-only (`POST /camera-edges`, same gate as registration; each
success writes one `camera.edge` audit row):

```bash
curl -X POST https://<server>:8443/v1/camera-edges \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"from":"<uuid-cam-01>","to":"<uuid-cam-02>",
       "mean_travel_s":95.0,"stddev_s":20.0}'
```

Rules the server enforces: `from` and `to` must differ (no self-loops),
`mean_travel_s` must be positive, `stddev_s` non-negative, and both
cameras must already be registered (unknown camera → `NOT_FOUND`).
Re-posting the same ordered pair replaces the statistics (they are
re-measured, not accumulated).

### How to verify a camera feed is being decoded with hardware acceleration

1. Confirm the codecs exist: `python -c "import av;
   print([c for c in av.codecs_available if 'cuvid' in c])"` must
   include `h264_cuvid` and `hevc_cuvid` (`STACK.md` §6).
2. Attach the camera and watch the per-feed effective-FPS readout in
   the video wall; during the M1-T2 acceptance, 4 RTSP + 4 file sources
   decode concurrently with sequence numbers and case-clock timestamps
   on every frame.
3. Pulling an RTSP cable must trigger reconnect with exponential
   backoff, not a crash. If frames flow on CPU fallback instead, FPS
   degrades uniformly by design (D14) — record that the session ran
   unaccelerated rather than treating the numbers as GPU numbers.

---

## Day-to-day operations

### Starting and stopping services

```bash
# Start / stop infrastructure
docker compose -f infra/compose/all-in-one.yml up -d
docker compose -f infra/compose/all-in-one.yml down      # containers stop, volumes kept
docker compose -f infra/compose/all-in-one.yml down -v   # also deletes postgres_data + neo4j_data

# Supabase local (schema path)
supabase start
supabase stop

# Server (blocks on the health gate unless --force; --force is for diagnosis only)
cargo run -p server
cargo run -p server -- --force   # starts despite red rows; never the pilot mode

# Engine node (serves :8756, POST /calibrate, MJPEG + WS overlays)
uvicorn engine.main:app --host 0.0.0.0 --port 8756

# Document lane (server-side, :8757)
uvicorn docs-lane.main:app --host 0.0.0.0 --port 8757   # module path as laid out in ARCHITECTURE.md §8; confirm against the tree on the pilot machine

# Ledger gateway (mock)
node ledger/gateway/server.js            # LEDGER_MODE defaults to mock; :8801
node ledger/mock/index.js                # standalone twin; the compose file runs the gateway, not this

# Client
cd client && npm run tauri dev
```

`down -v` and `supabase db reset` both destroy data. From M6 onward
`supabase db reset` is destructive to pilot data (rule 5) — back up
first (next section).

### Backing up the database

Back up the Supabase local Postgres (the schema path holding cases,
entities, and audit rows), the blob store (content-addressed files
keyed by SHA-256), and the ledger state. The minimum pilot backup is
the database dump plus a note of which blob directory and ledger mode
it pairs with — a dump without its blobs verifies hashes against
nothing.

```bash
# Database (Supabase local exposes Postgres on 54322 by default)
pg_dump "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
  -F c -f raven-pilot-<yyyymmdd>.dump

# Blobs: copy the content-addressed store directory as deployed on the
# pilot machine (path as configured there; confirm and record it).
# Ledger: in mock mode the log is in-process and resets with the
# container — record the mode alongside the dump. In fabric mode, the
# ledger persists on peers; back up per infra/fabric/README.md.
```

Store the dump on a separate drive from the pilot machine, labelled
with date, session reference, and the commit hash (`git rev-parse
--short HEAD`). After the pilot, export one named `pg_dump` artifact
before wiping anything (`PILOT_PROTOCOL.md` §7).

### Restoring from backup

```bash
# Restore into a FRESH reset (destroys whatever is in the database now)
supabase db reset
pg_restore -d "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
  --clean --if-exists raven-pilot-<yyyymmdd>.dump

# Then restore the blob directory to its configured path, restart
# services, and verify: GET /v1/health all green, spot-check GET
# /files/{id}/verify -> status verified on at least one anchored file.
```

A restore is not complete until a ledger verification passes: hashes
recomputed from restored bytes must match the anchored hashes, or the
restore is corrupt and the tamper state will (correctly) say so.

### Checking logs: which container, which log file

- `docker logs raven-postgres` / `raven-neo4j` / `raven-ledger-mock` /
  `raven-basemap` — container stdout for the four compose services.
- Server: structured logs with trace ids on stdout (`tracing` /
  `tracing-subscriber`); every error carries the `trace_id` from the
  API error envelope — grep that id across services to follow one
  request.
- Engine node / document lane: uvicorn stdout plus the FastAPI app
  logs. Calibration failures and server-registration failures
  (`registered: false`) are logged with exceptions, never swallowed.
- Supabase local: `supabase status` for ports and service state;
  Studio on :54323 for database inspection (read-only queries during
  the pilot; no manual schema changes — rule 5).

### Updating the system: migration-safe update process

1. Back up (previous section). Confirm the dump restores — an untested
   backup is a rumour.
2. `git pull` and note the new commit hash.
3. `cargo xtask generate-types` if any server API struct changed (D30).
4. Apply migrations only by adding new files (`supabase migration new
   <name>`); never edit an applied migration, never drop a column that
   holds data (rule 5). Run `supabase db reset` only on a machine whose
   data is expendable or backed up.
5. Re-run the gates: `cargo test --workspace`, `cd client && npm run
   build`, `pytest engine/ docs-lane/`, and `eval/test_rls.py` against
   the migrated database. A red RLS suite blocks release (NFR-8).
6. Re-verify `GET /v1/health` all green and re-record any `RESULTS.md`
   rows the update claims to change as new rows (D24 — never edits).

---

## Known limitations for the pilot

These are the honest boundaries of what the pilot can claim. Each is a
measured or verified gap, not a guess, and relaxing any of them to make
a demonstration look better is explicitly out of bounds.

- **S1b quality floor unmeasured (D14 placeholder) — what this means in
  practice.** `engine/detect.py`'s `quality_floor_fps()` raises rather
  than guessing, and the per-feed warning band below the floor cannot
  trigger on a measured value because no value exists: PETS2009 (the
  intended S1b source) is `BLOCKED` — its host is unreachable — and the
  fallbacks are dropped or licence-blocked (`RESULTS.md`
  S1b/PETS2009/full-split/STATUS rows, 2026-09-11 and 2026-09-13; D14).
  In practice: the scheduler still degrades FPS uniformly under load
  and the UI still shows per-feed effective FPS, but nobody can say
  below what FPS tracklet continuity degrades, because that curve was
  never measured. The pilot measures it (§4 of `PILOT_PROTOCOL.md`).
- **S2 multi-camera Re-ID blocked — system proposes candidates, human
  confirms, accuracy unquantified.** OSNet weights are downloaded and
  the x1.0 engine is exported and CUDA-verified, but no
  identity-labelled multi-camera data exists in the audited sources and
  no operating threshold is selected, so rank-1/mAP, IDF1/HOTA,
  precision-at-threshold, and the D15 topology-prior ablation are all
  unmeasurable (`RESULTS.md` S2 rows through 2026-09-15). The pipeline
  still proposes candidates with score, threshold, topology
  expectation, both crops, and time gap (FR-5.6), and nothing enters
  the case record without human confirmation (D9) — but the
  confirmation workload and the false-match rate are both unquantified.
- **S3 HTR blocked — all document recognition routes to review queue,
  no auto-extraction.** IIIT-INDIC-HW-WORDS is dropped (licence inside
  the zip, unverifiable without downloading) and IAM needs registration
  on an unreachable host (`RESULTS.md` S3 rows, 2026-09-13); no
  recogniser is trained and `docs-lane/gate.py` raises
  `CERGateNotRecorded` rather than guessing. Operative posture: every
  field routes to the review queue with a stated reason (FR-2.7
  assisted transcription). The pilot measures per-script CER on its own
  collected forms.
- **ts-rs CI check not yet in CI.** `cargo xtask generate-types`
  exists and works (D30, implemented 2026-09-15; output under
  `client/src/types/generated/`), but no CI job is verified in the
  tree that fails the build when the generated types drift from the
  Rust structs. Until such a check lands, `client/src/types/api.ts`
  (hand-written, marked temporary) must be kept in sync manually and is
  a known correctness risk.
- **Camera list unauthenticated (D32).** `GET /cameras` requires no
  authentication, deliberately: on a premises LAN, listing camera
  locations is not meaningfully protected by an auth gate, and the
  friction would fall on investigators checking feeds. Registration
  (`POST /cameras`) and topology edges (`POST /camera-edges`) are
  admin-only with audit rows. Revisit the moment the system is exposed
  beyond the premises LAN.
- **WebSocket §2.9 uses 30s polling.** The `§2.9` socket
  (`wss://{server}:8443/v1/ws?case_id=`) is pending server-side, so
  live-feeling screens poll instead of pretending a socket is
  connected: the home dashboard fetches the last-10 audit rows every
  30 seconds (stated in a code comment at
  `client/src/components/Home/HomeDashboard.tsx`), and the system
  health board refreshes on a 10-second interval
  (`client/src/components/Admin/SystemHealth.tsx`). Event latency in
  the pilot is therefore polling latency, and anything described as
  "live" must be read with that delay in mind.
