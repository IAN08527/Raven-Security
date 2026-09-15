# Security and Privacy Analysis — Raven Campus Pilot

**Status:** pilot analysis, accurate against the tree as of 2026-09-15.
**Companion document:** `docs/DPIA.md`. The DPIA asks what data is processed
and on what legal grounds. This document asks who can attack the system, how,
and what has been done about it.
**Reader:** a technically capable security evaluator, not a legal one.
**Rule for unknowns:** anything not verifiable from the tree, the docs, or
`docs/RESULTS.md` is stated as unknown with the reason it is unknown. Nothing
here is a placeholder and nothing is marked TBD.

---

## 1. Scope and assumptions

This threat model covers a premises-only deployment on a trusted LAN (the
campus pilot topology in `infra/compose/all-in-one.yml`: server, one engine
node, Postgres, Neo4j, mock ledger gateway, and basemap server on one machine
or one switched LAN segment).

- **Premises LAN is trusted; the perimeter belongs to the deploying agency.**
  Several controls in this document (unauthenticated camera listing per D32,
  plaintext inter-service traffic pending TLS, default compose credentials)
  are only defensible behind a controlled perimeter. Internet-facing
  deployment is explicitly out of scope and unsupported: D32 requires
  re-examination the moment the system is exposed beyond the LAN, and the
  unauthenticated routes documented in §2 must be re-gated before that.
- **Physical access to the server hardware is out of scope.** Database volume
  encryption is not configured (DPIA §2 states this plainly), stored blobs
  and embeddings are recoverable from the disk by anyone holding the machine,
  and audit-row immutability is a service-level property, not a disk-level
  one. Physical security of the pilot machine is the deploying agency's
  responsibility.
- **In scope:** network-adjacent attackers on the LAN (passive sniffing and
  active connection to any published port), compromised user credentials
  (a valid GoTrue token in the wrong hands), compromised client machines
  (a Tauri desktop holding a live session token), and insider threats —
  an authorised user attempting to exceed their role. The insider is treated
  as the most likely threat in a policing tool, and §6 is written accordingly.

---

## 2. Attack surface inventory

Every boundary below is reachable by any device on the premises LAN in the
all-in-one compose profile (each service publishes its port). "Exposed to"
means LAN-reachable, not internet-reachable — see §1.

| Boundary | Exposed to | Authentication | What an attacker gains on success |
|:---|:---|:---|:---|
| Server API `:8443` (HTTPS REST by contract; plaintext HTTP in the current tree — see §5) | Any LAN host; all pilot users | GoTrue RS256 Bearer token plus per-endpoint role gate plus per-case assignment check — **except** `GET /health` (no auth, by design), `GET /cameras` (no auth, by design per D32), `GET /v1/nodes` (no auth — health-board state, operator-visible like the camera list), and the graph projection reads (Bearer-presence check only, no signature verification — §6). `POST /v1/nodes` is admin-only with a `node.register` audit row (fixed; previously unauthenticated — see §9 history) | Full case-data access through the API: read any case's `source_files` rows and stored bytes, evidence and entity rows, candidate sightings, audit rows for assigned cases; confirm or reject sightings and merges as the compromised user; register cameras, engine nodes, and topology edges (admin token only); create or deactivate users (admin token only). A compromised admin token additionally yields account control but, by D21 enforcement, still no case content through the API — the attacker would need an officer/analyst token, or a database credential, for content. |
| Engine node `:8756` (HTTPS + MJPEG + WSS by contract) | Any LAN host (clients fetch video; server sends control) | **None in the current tree.** `engine/main.py` exposes only `POST /calibrate`, which takes no credential. The contract's MJPEG signed-query-token scheme (`API_CONTRACTS.md` §3.1: short-lived token issued by the server because `<img>` cannot send an `Authorization` header) is specified but not implemented — no issuance or verification code exists in the server or engine tree, and the MJPEG and overlay sockets themselves are not present in `engine/main.py`. Status: pending, not partially built. | Today: trigger calibration runs and observe calibration results (compute-budget disclosure, no case data). Once the specified endpoints land without their specified tokens, the gain becomes live pixels from any camera and, on the control socket, forged tracklets and candidate sightings pushed upstream toward human review. The token scheme must land together with the first streaming endpoint, not after it. |
| Neo4j Bolt `:7687` (HTTP `:7474`) | Any LAN host; engine nodes (topology reads) | Password authentication (`NEO4J_AUTH`, default `neo4j/ravenpassword` in `infra/compose/all-in-one.yml`; the server default `NEO4J_PASSWORD` must match it). No client-certificate or mTLS check in the current tree. | With the writer password: read the entire derived graph for all cases (person network, edge weights, camera topology) and write arbitrary nodes and edges, bypassing the server saga and therefore bypassing the audit emitter entirely — a false association injected here never produces an audit row. With only the engine's read-only topology credential: read camera topology, no writes (D10). The `:7474` browser endpoint exposes the same data over HTTP with the same password. |
| Postgres `:5432` | Any LAN host; server; Supabase local stack (GoTrue, PostgREST) | Password authentication (compose defaults `postgres/postgres` in `infra/compose/all-in-one.yml`). RLS policies constrain the `authenticated`/`anon` paths; a superuser or service-role connection is not constrained by RLS at all. | With database credentials: read and write every row for every case — `source_files`, entities, identifiers, relationships, evidence spans, appearance embeddings, `audit_log` — and rewrite or delete `audit_log` rows, since row immutability is enforced by the service never issuing deletes, not by any database-level deny. This is the highest-value credential in the system, above any user token. |
| Ledger gateway `:8801` | LAN hosts; server only in normal operation | **None in the current tree.** Both the mock (`ledger/mock/index.js`) and the gateway (`ledger/gateway/server.js`, plain Node `http`) validate required body fields and nothing else. | Write arbitrary anchors and actions (pollute the ledger with false hashes under an attacker-chosen `actorLedgerId`); read full anchor/action history including hashes, case ids, and actor ledger ids (metadata, not case content). In mock mode the log is a single-process store, so an attacker with host access can additionally rewrite history — the tamper-evidence property does not exist in mock mode (§4). In fabric mode a forged entry still cannot acquire genuine multi-org endorsements, so verification against the endorsement policy detects it. |
| Basemap server `:8802` | Any LAN host; browser clients (MapLibre byte-range GETs) | **None, by design.** Static nginx file server over public tile and glyph data. | Tile bytes and font glyphs only: ODbL OpenStreetMap geometry for the configured extract plus locally served glyphs. No case data of any kind is stored here or reachable through it. CORS is open (`Access-Control-Allow-Origin *`), which is acceptable precisely because every byte served is already public data. |
| Camera RTSP feeds | Any LAN-connected device, independent of Raven | Not managed by Raven in the current tree: no RTSP credential issuance, rotation, or verification code exists in the server or engine. Whatever authentication the feeds have is whatever each camera unit was configured with at installation — **unknown from this tree**, because camera-side configuration lives outside this repository. | Live video from any camera whose URI the attacker knows or discovers, without touching Raven at all. `GET /cameras` (unauthenticated per D32) hands the attacker the complete URI list, so discovery costs one unauthenticated HTTP request. See the D32 note below. |

**D32 note (explicit).** `GET /cameras` requires no authentication by recorded
decision, not by oversight (`docs/DECISIONS.md` D32; pinned by
`server/tests/cameras.rs`, `list_cameras_needs_no_authentication`). An
attacker gains camera codes, labels, LAN locations (lat/lon), feed URIs,
declared start times, frame rates, and node assignments. This was accepted on
the grounds that any authenticated listing on a premises LAN discloses the
same information to anyone with LAN access, so the auth gate buys no real
confidentiality while adding friction for investigators checking feeds.
Registration (`POST /cameras`) and topology edges (`POST /camera-edges`) stay
admin-only with platform-scoped audit rows. The decision reverses if the
system is ever exposed beyond the LAN.

**Default-credential note (verified in the tree).** The all-in-one compose
file ships working defaults for both databases (`postgres/postgres`,
`neo4j/ravenpassword`). On a trusted pilot LAN with no exposure beyond it,
these are a documented weakness rather than an incident; before any
deployment beyond the pilot machine they must be replaced with
deployment-specific secrets, because the database credentials are the keys to
§2's highest-value rows.

---

## 3. Authentication and authorisation

### 3.1 GoTrue RS256 JWT verification (M5-T1)

Implemented in `server/src/auth.rs` (`JwksCache::verify`), tested in
`server/tests/auth_jwt.rs`. On every authenticated request the server checks:

- **Signature:** RS256 against the GoTrue JWKS, fetched over loopback
  (`SUPABASE_URL/auth/v1/.well-known/jwks.json`, default
  `http://127.0.0.1:54321`). Unknown `kid` triggers one refresh (key
  rotation) and a single retry before failure. Non-RS256 algorithms are
  rejected outright.
- **Expiry:** enforced by the `jsonwebtoken` validation on every request.
  Access-token lifetime is 3600 seconds (`supabase/config.toml`,
  `jwt_expiry = 3600`).
- **Issuer:** pinned to the expected GoTrue issuer derived from the JWKS URL.
- **Audience:** pinned to `authenticated` (GoTrue access-token audience).
- **Role binding:** `app_metadata.app_role` (fallback
  `user_metadata.app_role`) must parse to a known `AppRole`; a missing or
  unknown role is `FORBIDDEN`, never defaulted to a permissive role.

What it does **not** check:

- **Revocation.** There is no token blacklist and no introspection call. A
  deactivated user's already-issued token remains cryptographically valid
  until its one-hour expiry. This is mitigated, not fixed, by the in-memory
  directory overlay (`UsersStore`, attached in `server/src/main.rs`):
  deactivation flips `active` to false and `verify` rejects that user's
  tokens with `UNAUTHENTICATED` on every endpoint, with no per-handler check
  to forget. Known limitation of the mitigation: the directory is currently
  in-memory rather than per-request Postgres state, so it covers only the
  running server process; a restart loses the overlay contents and falls
  back to GoTrue as the source of truth until the admin store is reattached
  (both follow-ups are recorded at the call sites, not hidden).
- **Session continuity.** There is no server-side session object beyond the
  token itself; each REST request is verified independently, which is the
  correct posture and leaves no session-fixation surface.

### 3.2 Role separation (D21)

Four roles, enforced server-side on every gated route (`server/src/auth.rs`
`AppRole`; capability matrix `docs/PRD.md` §2):

| Role | Can | Cannot |
|:---|:---|:---|
| Investigating officer (`io`) | Ingest documents, run ego-graph queries, lock on to targets, confirm or reject sightings and merges, annotate, correct review items | See cases they are not assigned to |
| Intelligence analyst (`analyst`) | Macro network views, cross-case pattern queries over assigned cases, routine analysis, read files and timelines | Confirm or reject sightings, modify case records |
| Forensic auditor (`auditor`) | Read-only review across assigned cases, ledger verification of any document, access-log review | Modify any record, including their own annotations |
| Administrator (`admin`) | User and case assignment, camera and node registration, form template management | Read case content — deliberate exclusion, enforced by the role gates (admin appears in no case-content route's allowed set) |

The admin exclusion exists so that system administration and intelligence
access are separable duties: the person who can create accounts and register
cameras cannot read what the cases contain. Cross-case reads are denied with
`CASE_ACCESS_DENIED`, never answered with an empty list (an empty list would
let an attacker distinguish "no such case" from "not your case" and would
hide misconfiguration as absence).

### 3.3 Row-level security (M0-T4)

RLS is enforced at the database layer in the Supabase migrations, not in
application code. `docs/RESULTS.md` carries two independent `M0-T4-rls` PASS
rows (commits `f0d09d6` and `e951ad6`), each recording **81/81
`eval/test_rls.py` green against a fresh `supabase db reset`**, covering
cross-case read denial on every content table, admin zero-content access,
and the D28 `insight_reviews` tightening with fail-closed behaviour on
unresolvable polymorphic types.

What RLS does **not** protect against: any connection holding a service-role
key or superuser credential bypasses RLS entirely — that is what those keys
are for. The standing rule (`API_CONTRACTS.md` §2, CLAUDE.md) is that the
application never uses a service-role key on behalf of a user; all
user-facing queries ride the authenticated path. A service-role key
appearing in application request paths, logs, or the client bundle is
therefore treated as a security bug, not a configuration choice. The current
tree upholds this: no service-role usage exists in the server request paths.

### 3.4 The single Neo4j writer rule (D10)

Exactly one component writes to Neo4j: the server saga. Engine nodes hold
read-only Bolt credentials used solely for camera-topology queries
(`engine/topology.py`, `load_edges_from_neo4j`); the document lane holds no
graph credentials at all. Every graph mutation therefore passes the audit
emitter.

Security property this buys: **a compromised engine node cannot inject false
graph edges.** The most it can do with its own credential is read topology.
An attacker who wants a forged association in the graph must either hold the
server's writer credential (§2, Neo4j row) or act through the API as a
compromised officer account (attributable, anchored, reversible — §6, §4).

### 3.5 Known gaps in authentication

- **No token revocation beyond the directory overlay** (§3.1). A deactivated
  user's token is rejected only while the overlay is attached and populated.
- **WebSocket authentication is handshake-only by contract, and the socket
  does not exist yet in the tree.** `API_CONTRACTS.md` §2.9 specifies
  `wss://{server}:8443/v1/ws?case_id=`; the server router
  (`server/src/api/mod.rs`) serves no WebSocket route, and `docs/DEPLOYMENT.md`
  records the socket as pending server-side with screens polling instead
  (30-second dashboard poll, 10-second health poll). Consequence: the
  mid-session-expiry question — a token expiring while a socket stays open —
  is currently answered by polling behaviour (each poll re-presents the
  Bearer token, so expiry takes effect at the next poll), but the specified
  socket, when built, must re-verify on a schedule rather than trusting the
  handshake indefinitely. The same applies to the specified engine overlay
  socket (`wss://{node}:8756/ws/cv/{camera_code}`), which likewise has no
  implementation in `engine/main.py`.
- **Camera stream tokens are pending** (§2, engine row). The contract's
  short-lived signed query token for MJPEG exists only on paper. Until it is
  implemented, the first streaming endpoint must not be exposed without it.
- **Node registration is admin-gated (fixed).** `POST /v1/nodes`
  (`server/src/api/nodes.rs`) previously accepted registrations with no
  credential at all; it now requires a verified admin JWT before any body
  processing (401 without token, 403 for non-admin) and writes one
  platform-scoped `node.register` audit row per success — the same fix class
  as `POST /cameras` (e951ad6). `GET /v1/nodes` stays unauthenticated by
  design: the health board is operator-visible state, like the D32 camera
  list.

---

## 4. Data integrity

### 4.1 SHA-256 content-addressed blob storage (FR-1.2)

Every ingested file is stored under its SHA-256, computed streaming in
fixed 64 KiB chunks so large dumps never balloon memory (`server/src/api/files.rs`,
`HASH_CHUNK_BYTES`; ingest saga streams the hash before any row is written).
This prevents **silent file modification**: any byte changed after ingest
produces a different hash, and verification (`GET /files/{id}/verify`)
re-hashes the stored blob and compares it against the ledger anchor —
equal verifies, differing tampers with both hashes shown, missing anchor or
unreachable gateway reports `pending`, never a silent pass (NFR-7 targets
100% detection of single-byte modification; the tamper path is exercised by
a test-only corruption entry point, with no production code path that
mutates a stored blob).

What it does **not** prevent: **deletion.** A missing blob or missing row
hashes to nothing — verification reports the absence but cannot recover the
content. Backup and restore (FR-8.4) is the control for deletion, and its
pilot procedure is unwritten: unknown from this tree whether tested restores
exist.

### 4.2 Ledger anchoring (D5, D22)

Two anchors per document (D5): the file hash is anchored at ingest because it
is a fact about bytes; the extraction-result hash is anchored only after the
Postgres commit succeeds. Two transaction ids per document are tracked for
this reason.

In fabric mode, writes require endorsement under
`AND('district-cid.member','cyber-cell.member')` (`ledger/gateway/policy.js`,
tested in `ledger/gateway/test/policy.test.js`; chaincode appends each
creator org's endorsement in `ledger/chaincode/contract.js`). What multi-org
endorsement prevents: **a single compromised peer forging a valid anchor** —
one organisation's signature never satisfies the policy, and mock entries
(`mode: 'mock'`) are explicitly excluded from satisfying it. What it does not
prevent: **collusion across all endorsing organisations.** An attacker
controlling both endorsers rewrites the record legitimately as far as the
policy can tell; the control raises the bar from one compromised machine to
cross-agency conspiracy, which is the property that makes the tamper claim
non-trivial (D22).

Pilot honesty condition: the campus pilot runs the mock ledger
(`LEDGER_MODE=mock`, the compose `ledger-mock` service) — a single-process
signed log whose endorsements are `[{org:'mock', mode:'mock'}]`. The mock
provides **none** of the multi-org property above, and mock endorsements
must always render with the amber MOCK LEDGER badge, never as real
endorsements (the UI is required to distinguish them; a mock endorsement
dressed as real is the exact misrepresentation D22 exists to avoid).

### 4.3 Tamper detection propagation (FR-4.6)

A source file that fails verification marks every derived entity and edge:
evidence rows carry `tamper_state`, and tampered derivations are excluded
from analysis until resolved (`server/src/graph/mod.rs` evidence path;
`GET /edges/{id}/evidence` surfaces the state per row).

Detection gap, stated plainly: **the ledger anchors the hash at ingest time,
so a file modified before ingestion is not detected.** The anchor attests
"these are the bytes we received," not "these are the bytes the source
produced." Chain-of-custody before the ingest boundary — seizure, transport,
copying onto the pilot machine — is procedural, not cryptographic, and
nothing in this system verifies it.

### 4.4 Revert mechanism for entity merges (FR-3.3)

Merges are proposals (`status='proposed'`) until a human confirms; the
baseline schema carries `entity_merges.reversible_snapshot` (the merged
row's pre-merge state) and a `reverted_at` column, so a wrong merge — two
people's records fused — can be unwound by restoring the snapshot.

Two honest qualifications. First, **the revert exists in the schema but has
no HTTP route in the current server tree**: `API_CONTRACTS.md` §2.5 lists
`POST /merges/{id}/revert`, but the entities router serves only propose,
decide, list, read, and notes — no revert handler exists. Until the endpoint
lands, unwinding a merge means direct database intervention, which bypasses
the audit emitter and should be treated as an exceptional, separately
recorded act. Second, **some things are not reversible by design**: ledger
entries (append-only; erasure is a new ledger action, never a deletion —
DPIA §5), confirmed sightings once anchored, and `audit_log` rows (the
service issues no deletes; there is no delete path for accountability
records).

---

## 5. Network security

- **TLS on all inter-service traffic is the design requirement; it is not
  implemented in the current tree.** `ARCHITECTURE.md` §1.1 and
  `API_CONTRACTS.md` both mandate TLS with mutual authentication on every
  boundary including loopback in the development profile. The all-in-one
  compose file states in its own header that everything below is plain
  HTTP/Bolt on a trusted local network (flagged since M0-T8, not fixed).
  Verified against the tree: the server binds a plain `TcpListener` on
  `:8443` with no TLS acceptor (`server/src/main.rs`); the engine defaults
  to `http://server:8443` (`engine/main.py`); the ledger gateway is plain
  Node `http` on `:8801`; the basemap is plain HTTP on `:8802`; Neo4j is
  plain `bolt://` with password auth. Client libraries are TLS-capable
  (`rustls-tls` in the server and Tauri clients), so no dependency change is
  needed — but capability is not deployment, and a LAN sniffer today reads
  everything including Bearer tokens. The pilot compensates with a trusted
  premises LAN and no exposure beyond it. This is compensation, not
  compliance: mutual TLS must land before any agency pilot, and its arrival
  must include certificate provisioning and rotation, which are currently
  undesigned — unknown with that reason.
- **Zero external network egress (rule 6, D6, NFR-6).** Verified by the CI
  egress gate `eval/test_no_egress.py` on every build: 7 test functions,
  parametrized across engine and docs-lane modules (import-time `connect`
  interception against an allowlist of localhost plus 192.168.0.0/16 and
  10.0.0.0/8, with a permanent canary proving the guard itself still
  blocks), the built client bundle (resource-loading patterns: `src=`,
  `<link href=`, CSS `url()`, `fetch()`, `WebSocket` — bare `<a href=>`
  anchors excluded per D31 because they require a user click), and the
  server Rust sources. What the gate does **not** cover: runtime DNS lookups
  performed by Docker containers or system libraries beneath the
  application, behaviour of third-party packages after import time, and any
  host the operator types into a browser. The gate proves the code as
  shipped dials nowhere; it does not prove the machine cannot be made to.
  The pilot machine can be taken offline after setup with no loss of
  function (map tiles and fonts are local — D6).
- **Camera RTSP on the LAN.** Feed URIs are reachable by any LAN-connected
  device independent of Raven, and `GET /cameras` publishes the full list
  without authentication (D32 note in §2). An attacker with LAN access views
  camera feeds directly without presenting any credential to Raven. This is
  accepted LAN-trust posture, not an oversight, and it reverses with D32 if
  the network boundary ever changes.
- **Basemap `:8802` is unauthenticated and that is acceptable.** It serves
  static public tile geometry and font glyphs — no case data, no user data,
  no query interface. There is nothing to authenticate access to that is not
  already public (RESULTS.md `tiles-audit` rows record the extract's ODbL
  provenance and the glyphs' Apache-2.0 licensing).

---

## 6. Insider threat and audit

The authorised user acting outside their role is the primary threat for this
system, so this section is the longest. The mechanism is the audit emitter
(M5-T3): every mutating handler calls `record_action`
(`server/src/audit/mod.rs`), which writes one immutable `audit_log` row and
attempts a ledger anchor **before the endpoint returns**, so a recorded
action and its cryptographic receipt travel together.

**What the audit log covers in the current tree** (each verified at its call
site): sighting lock-on and candidate confirmations/rejections (io only),
merge proposals and confirm/reject decisions, review corrections, acceptances
and rejections, preview-extraction calls, entity listing and single-entity
reads, entity notes, file reads and verifications, case-timeline reads,
movement-timeline and routine reads, global search queries (one
`search.query` row per call; platform-scoped nil-`case_id` when no case is
specified), camera registrations and topology-edge creations
(`camera.register`, `camera.edge`, platform-scoped), and user
creation/deactivation (platform-scoped). File reads by any assigned role —
including the auditor — are logged, so access itself is evidence.

**What it does not cover:**

- **Graph projection reads are not individually audited.** The ego, macro,
  and edge-evidence handlers write no audit rows. Worse than a logging gap,
  these three routes are also the weakest-authenticated case-data reads in
  the tree: they check only Bearer-token *presence*
  (`server/src/graph/mod.rs`, `require_session`), performing no signature,
  expiry, issuer, or role verification and no case-assignment check. Any
  well-formed `Authorization: Bearer <non-empty>` value reaches the
  projection. Before any deployment beyond the pilot, these routes must be
  moved onto `authenticate_request` with the io/analyst/auditor gate and
  given read audit rows like every other case-data read.
- **Search queries are audited — no gap here.** This item is listed because
  read-path auditing was assumed incomplete; verification against
  `server/src/api/search.rs` shows every call writes a `search.query` row.
  It is recorded so a future regression (removing that call) reads as a
  regression, not as intended behaviour.
- **Ledger identity is optional.** Users without a `profiles.ledger_id`
  proceed with `ledger_status='skipped_no_identity'` — the action is
  performed and audit-logged locally but is not cryptographically
  attributable to a ledger identity (`server/src/audit/mod.rs`; same path in
  the Re-ID lock-on flow). Until the Fabric org issues every user an
  identity, a share of pilot actions will be locally accountable but not
  ledger-attributable, and the proportion should be reported, not assumed
  small.
- **WebSocket events are not individually audited.** Trivially true today:
  no server WebSocket exists (§3.5), so there is nothing to log. When the
  §2.9 socket lands, candidate pushes, loss notices, and any socket-level
  widen-search action need audit semantics decided in the same change.
- **Node registration is audited (fixed).** Successful `POST /v1/nodes`
  calls write `node.register` rows (§3.5); rejected ones audit nothing, like
  every other gated mutation.

**Ledger attribution (D21).** Confirmations, rejections, merges, and evidence
access are signed with the acting user's ledger identity via the gateway's
`/action` endpoint carrying `actorLedgerId`. The `skipped_no_identity` path
above is the known hole: attribution degrades silently into local-only
logging unless reviewers watch the `ledger_status` column.

**The forensic auditor role.** Read-only across assigned cases: full access
and action history, independent document verification with both hashes
shown. Limitation: assignment-scoped, not system-wide — the auditor sees
only their assigned cases, so cross-case misuse by an officer holding two
assignments is visible only to an auditor assigned to both, and
platform-scoped rows (admin actions, camera administration, unscoped
searches) require an auditor with platform visibility, a grant that is
currently procedural rather than enforced in code.

**Role separation enforcement.** Admin cannot read case content (D21
deliberate exclusion, enforced in the route gates — admin appears in no
case-content allowed set, and the RLS suite proves zero admin content access
at the database layer). System administration and intelligence access stay
separable even when both are compromised individually; only a compromised
officer or analyst credential — or a database credential — reads cases.

---

## 7. What the system deliberately does not do

Each exclusion removes a category of harm. All seven are permanent design
positions, not deferred work.

- **No facial recognition against identity databases.** Appearance embeddings
  (OSNet 512-d, session-scoped) encode whole-appearance similarity for
  within-session matching across cameras. There is no face-template table,
  no face-matching endpoint, and no identity database anywhere in the
  system to match against (PRD §5 permanent exclusion, D9). An embedding
  cannot be turned into a name by this system under any code path.
- **No automatic identity assertion.** Every cross-camera match is a
  proposal with `status='proposed'`; a human confirms before anything enters
  the case record, the graph, or the map. There is no code path that skips
  this, no config flag that disables it, and no auto-confirm-above-threshold
  shortcut (D9, CLAUDE.md rule 1 — the single most important rule in the
  repository, restated because violating it silently would be the most
  harmful possible bug).
- **No risk scoring of individuals.** Movement-routine analysis over
  confirmed historical data is in scope; scoring or forecasting who will
  offend is excluded permanently, not pending a measurement (PRD §5; the
  entity-listing API carries no `risk_score` field by design, so there is
  nowhere to put a score even if one were computed).
- **No cloud API calls at any point in the pipeline.** Extraction,
  recognition, and matching run on local hardware; map tiles and fonts are
  local; the CI egress gate fails the build on any third-party request
  (rule 6, D6, NFR-6, §5).
- **No audio capture.** Camera feeds are video only. Collection uses
  picture-only recording, and no table in the schema has anywhere to store
  audio — the absence is structural, not policy text.
- **No persistent storage of raw video frames.** Frames are decoded, detected,
  and tracked in memory and streamed as MJPEG; what persists is detections,
  tracklets, and (only after human lock-on) appearance embeddings — never
  the pixels (DPIA §2, §4). A database compromise yields vectors and
  metadata, not footage.
- **No predictive policing outputs of any other kind.** Loss is stated rather
  than extrapolated (FR-5.8: the UI says the target was lost at a named
  camera and offers to widen the search); thresholds stay visible rather
  than collapsing to verdicts (FR-5.6). The system proposes and explains; it
  does not conclude.

---

## 8. Known open risks

These are the honest state of a system in pilot, not failures. They are
ordered by harm, not by ease of fixing.

- **Re-ID model bias is unassessed — the principal risk in this document.**
  Appearance-matching accuracy may vary across demographic groups, clothing
  styles, body types, lighting conditions, and skin tones. No disaggregated
  accuracy measurement exists for the detector, tracker, or embedder.
  `docs/RESULTS.md` carries S2 `STATUS/BLOCKED` rows (2026-09-13 measurement
  attempt; 2026-09-15 re-audit confirms the position): no OSNet weights
  cached, no identity-labelled cross-camera splits available under a
  verifiable licence, no operating threshold selected — so rank-1, mAP,
  IDF1, and precision-at-threshold are all unmeasured, and fairness
  disaggregation on top of unmeasured accuracy is doubly so. Until S2
  completes with a documented, diverse-enough participant set, the system's
  false-match rate across demographic groups is **unknown**, and any claim
  of equal performance is unearned — none is made here. This must be
  assessed before any operational deployment of a policing tool, without
  exception.
- **S2 cross-camera accuracy is unquantified.** The topology prior (D15) is
  implemented but its effect on precision has not been measured; the
  prior-ablation experiment is blocked on the same missing weights and
  splits as above. D15 stands unflagged pending measurement following the
  same discipline as D27 — absence of a negative finding is not a positive
  one.
- **Inter-service TLS is unimplemented** (§5, verified in the tree). Bearer
  tokens, database passwords, video, and case data all traverse the LAN in
  plaintext. Acceptable on the trusted pilot LAN; a blocker for any
  agency pilot.
- **Graph reads are weakly authenticated and unaudited** (§6). The ego,
  macro, and evidence routes accept any non-empty Bearer value and log
  nothing. This is the largest currently-exploitable gap below the
  plaintext-TLS item, because it requires only LAN access and no credential.
- **Single server is a single point of failure** (`ARCHITECTURE.md` §10.5).
  Acceptable at pilot scale: any single service restart must lose no
  committed data (NFR-9), but total host loss halts everything including the
  audit trail's availability. Not beyond pilot scale.
- **Ledger identity coverage is partial** (§6, `skipped_no_identity`). Every
  unattributed action weakens the evidentiary chain the ledger exists to
  provide; the pilot should track the unattributed share.
- **Merge revert has no API route** (§4.4). Schema-ready, endpoint-missing;
  the safety net against fused records currently requires unaudited direct
  database work.
- **Token expiry mid-session is a prospective gap** (§3.5). Polling clients
  re-authenticate per request today; the specified WebSocket must not
  convert that into authenticate-once semantics when it lands.
- **Tracklet-embedding retention interval is unconfigured** (D7, PRD Q5,
  DPIA §8). The policy direction — confirmed sightings retained,
  unconfirmed embeddings expire — is decided; the exact expiry is not. An
  unbounded embedding gallery is slow-motion data hoarding and extends the
  exposure window of every stored vector; the interval must be set before
  continuous operation.
- **Backup-and-restore procedure is unverified** (§4.1). Deletion is the one
  integrity event content-addressing cannot survive, and no tested restore
  is evidenced in the tree.

---

## 9. Review and update schedule

| Trigger | Who reviews | What happens |
|:---|:---|:---|
| Before each pilot deployment | Project lead plus the faculty contact who signs off on the pilot | Re-read this document against the actual machine, data, and participant set; re-verify §2 port exposure and §5 TLS status; confirm consent behaviour matches the running system |
| After any significant architecture change (new network path, new role or permission, Fabric replacing mock, TLS landing, revert endpoint landing, graph routes re-gated) | Project team | Amend the affected section in the same change — same discipline as `DECISIONS.md`: mark superseded text, never silently overwrite; record the amendment date |
| After S2 Re-ID accuracy is measured (results land in `RESULTS.md`) | Project team | Update §8: the model-bias section is rewritten with measured disaggregated numbers or explicitly restated as still open; likelihoods re-scored with numbers |
| Before any agency engagement | Project lead plus the faculty contact | Full pass: default credentials, TLS state, graph-route auth, node-registration auth, and ledger mode must each read as agency-ready or the engagement does not proceed on those items |
| After DPDP Act Rules are published | Project lead | Joint re-verification with DPIA §§3–5; any consent-wording or breach-procedure the Rules require is reflected before the next collection |
| Annually at minimum, even if nothing changed | Project lead | Confirm-or-update pass; a year with no review is a process failure |

*Document history: created 2026-09-15 for the M6 campus pilot preparation.
Amendment 2026-09-15 (node-registration auth fix): `POST /v1/nodes` is now
admin-gated with `node.register` audit rows; §§2, 3.5, 6, 8 updated in the
same change.
No prior version exists; the first review is the pre-pilot review above.
Every factual claim about implementation state was verified against the
tree on that date; where the tree was silent, the silence is recorded as
unknown with its reason rather than filled in.*
