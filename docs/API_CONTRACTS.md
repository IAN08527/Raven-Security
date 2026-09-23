# API Contracts

Four boundaries. Each side implements exactly what is here. If a change is needed,
change this file first, then both sides.

| Boundary | Transport | Defined in |
|:---|:---|:---|
| Client to server | HTTPS REST + WSS | §2 |
| Client to engine node | MJPEG + WSS | §3 |
| Server to engine node | HTTPS REST + WSS | §4 |
| Server to ledger gateway | HTTP REST | §5 |

All inter-service traffic is TLS with mutual authentication, including in the
all-in-one development profile. Running it in development is how you find out it
is broken before a pilot does.

---

## 1. Common shapes

### 1.1 Error envelope

Every service, every non-2xx response, no exceptions.

```json
{
  "error": {
    "code": "VRAM_EXHAUSTED",
    "message": "Engine node cannot allocate for this batch size.",
    "detail": { "requested_mb": 2048, "available_mb": 512 },
    "retryable": true,
    "trace_id": "01JBQ..."
  }
}
```

`code` is SCREAMING_SNAKE and stable; clients branch on it. `message` is for
humans and may change. `retryable` tells the caller whether a retry can succeed.
`trace_id` is a ULID propagated across every service in the request path.

Codes in use: `UNAUTHENTICATED`, `FORBIDDEN`, `CASE_ACCESS_DENIED`, `NOT_FOUND`,
`VALIDATION_FAILED`, `UNSUPPORTED_MIME`, `HASH_MISMATCH`, `LEDGER_UNAVAILABLE`,
`GRAPH_SYNC_PENDING`, `VRAM_EXHAUSTED`, `NODE_UNAVAILABLE`, `BUDGET_EXCEEDED`,
`SCRIPT_NOT_GATED`, `REVIEW_REQUIRED`, `CONFLICT`, `INTERNAL`.

### 1.2 Event envelope

Every WebSocket message on every socket.

```json
{
  "v": 1,
  "type": "reid.candidate",
  "ts": "2026-03-14T09:12:44.221Z",
  "case_clock_ts": "2025-11-02T14:23:07.500Z",
  "trace_id": "01JBQ...",
  "payload": { }
}
```

`ts` is wall-clock, for ordering the socket. `case_clock_ts` is the case clock and
is what the payload actually means (D16). Any event about a frame, a detection or
a sighting carries both. Confusing them is the single easiest way to corrupt
cross-camera reasoning.

Event types: `ingest.progress`, `ingest.complete`, `ingest.failed`,
`review.queued`, `graph.sync`, `cv.boxes`, `cv.tracklet`, `reid.candidate`,
`reid.decided`, `reid.lost`, `node.status`, `budget.changed`, `ledger.status`.

### 1.3 Conventions

- Timestamps: RFC 3339 with milliseconds, always UTC.
- Ids: UUID v4 as strings, except `bigserial` tables which use integers.
- Vectors: base64-encoded float32 little-endian, never JSON arrays of floats.
- Pagination: `?limit=&cursor=`, response carries `next_cursor` or null.
- Idempotency: every mutating endpoint accepts `Idempotency-Key`. Saga steps
  depend on this.

---

## 2. Client to server

Base `https://{server}:8443/v1`. Bearer token from GoTrue. RLS applies to
everything; the server never uses a service-role key on behalf of a user.

### 2.1 Cases and access

```
GET    /cases                          -> [{id, case_code, title}] (assigned only; admin sees every case, D37)
GET    /cases/{id}                     -> {case, assignments: [{user_id, assigned_role}]}
POST   /cases                          {case_code, title} -> 201 + case record
POST   /cases/{id}/assignments         {user_id, assigned_role}
```

`POST /cases`: admin role only (opening a case is a platform act). The
administrator separately has unrestricted read access to what goes inside
it (D37 amends D21), but not write/confirm capability. Blank
`case_code`/`title` is `422`; duplicate `case_code` is `409`; every
creation writes one `case.create` audit row. Creation dual-writes the row
to Postgres through the saga role (D33) so later uploads satisfy the
`source_files` foreign key; a durable failure is `500` with nothing kept
in memory. `GET /cases` returns the caller's assigned cases in
`case_code` order for io, analyst and auditor; for admin it returns
every case unconditionally (D37). `GET /cases/{id}` is `404` on unknown
cases and `403` without an assignment (admin is exempt from the
assignment check but not the `404`). (`jurisdiction` from the earlier
draft is deferred: the record carries `id`, `case_code`, `title` only.)

### 2.2 Ingestion

```
POST   /cases/{id}/files               multipart, returns {file_id, sha256, status}
GET    /files/{id}                     -> file record + ingest_jobs history
GET    /files/{id}/verify              -> {status: verified|tampered|pending,
                                            ledger_hash, computed_hash, tx_id}
POST   /files/{id}/retry               restart a failed stage
```

Upload responds as soon as the file is hashed and stored, before recognition.
Progress arrives on the socket as `ingest.progress`. A client that blocks on the
HTTP response for a scanned 40-page document is doing it wrong.

`POST /cases/{id}/files`: Auth: io role only (D34).

`POST /files/{id}/retry`: Auth: io role only. Eligible:
`source_files.status` IN (`failed`, `needs_review`). Other statuses:
409 `CONFLICT`. Resets status to `received`, clears `ledger_tx_id`,
spawns saga.

### 2.3 Review queue

```
GET    /cases/{id}/review?status=pending   -> [{id, crop_url, recognised_text,
                                                 confidence, script, field_name}]
POST   /review/{id}                        {corrected_text, status}
POST   /cases/{id}/preview-extraction      {text, surfaces: [{type, value}]}
                                           -> [{type, value, char_start, char_end,
                                               found}]
```

`SCRIPT_NOT_GATED` on any attempt to auto-commit extraction from a script below
its CER gate (FR-2.6).

`POST /cases/{id}/preview-extraction` (D29) is io role only. It runs
span resolution only — no model call, no persistence: caller-supplied
`{type, value}` surfaces are grounded against the supplied text and
returned with character offsets. Surfaces absent from the text come
back with `char_start`/`char_end` null and `found: false`, not an
error; an empty `surfaces` array returns an empty array. Every call
writes one `preview.extraction` audit row (rule 6).

### 2.4 Graph

```
GET  /cases/{id}/graph/ego?entity_id=&hops=2&min_weight=5&types=PERSON
GET  /cases/{id}/graph/macro?min_weight=
GET  /edges/{id}/evidence               -> [{kind, snippet, char_start, char_end,
                                              page_no, source_file_id, provenance,
                                              tamper_state}]
POST /cases/{id}/graph/rebuild          admin only, regenerates Neo4j from Postgres
```

`types` defaults to `PERSON` only (D23). Other entity types are returned only when
explicitly requested.

Edge evidence is a separate call by design: fetching it must never trigger a graph
re-query or a layout reflow.

### 2.5 Entities

```
GET    /cases/{id}/entities?type=&search=&limit=&cursor=
                                        -> {results: [{id, type, canonical_name,
                                            identifiers[], case_count,
                                            provenance, sync_state}],
                                            next_cursor}
GET    /entities/{id}                   -> entity + identifiers + aliases +
                                            associated cases + provenance
POST   /entities/merge                  {surviving_id, merged_id, reason}
                                        -> status 'proposed', never applied directly
POST   /merges/{id}/decide              {decision: confirmed|rejected}
POST   /merges/{id}/revert
POST   /entities/{id}/notes             {text} -> 201 + note
                                        {id, entity_id, text, created_by,
                                         created_at}
```

`GET /cases/{id}/entities`: any assigned role (io, analyst, auditor), plus
admin unconditionally (D37 amends D21); unassigned non-admin callers get
`CASE_ACCESS_DENIED`, never an empty list. `type`
filters to one `entity_type` (PERSON, ORGANIZATION, LOCATION, VEHICLE,
ACCOUNT) and defaults to all types — this is a listing endpoint, so the
D23 person-centric default (which governs graph rendering) does not apply.
Unknown `type` values are `VALIDATION_FAILED`, not an empty list.
`search` is a case-insensitive substring match over `canonical_name` and
`entity_aliases`. Pagination follows §1.3 (`limit`, opaque `cursor`,
`next_cursor` null at the end. No `risk_score` field and no `min_risk`
filter: PRD §5 excludes risk scoring of individuals, so listing and
sorting use evidence-backed fields (edge weight, evidence count) instead.

Notes are annotations (FR-7.4): `POST /entities/{id}/notes` is io role
only (the auditor is read-only, the analyst views), scoped to the
entity's case like every other entity read, and every note is attributed
to its verified author, audit-logged and ledger-anchored. `GET
/entities/{id}` embeds the entity's notes. Note text is capped at 2000
characters (transport guard, `VALIDATION_FAILED` beyond); empty text is
rejected the same way.

### 2.6 Cameras and tracking

```
GET    /cameras                         -> [{id, code, label, lat, lon, mode,
                                              declared_start_ts, fps, effective_fps,
                                              status, node_id, stream_url}]
POST   /cameras                         admin; declared_start_ts is required
POST   /camera-edges                    {from, to, mean_travel_s, stddev_s}

POST   /cases/{id}/targets              {camera_id, track_id, label}
                                        -> lock-on; signed and anchored (D9)
GET    /targets/{id}/candidates?status=proposed
POST   /candidates/{id}/decide          {decision: confirmed|rejected, note}
DELETE /targets/{id}                    end tracking
```

`stream_url` points at the engine node, not the server. Video never proxies
through the server.

`GET /cameras` requires no authentication (D32: camera locations on a
premises LAN are not meaningfully protected by an auth gate). `POST
/cameras` and `POST /camera-edges` are admin-only; each success writes
one platform-scoped (nil-`case_id`, like §2.11) audit row —
`camera.register` / `camera.edge` — before returning (rule 6).

### 2.7 Map

```
GET /entities/{id}/timeline?from=&to=   -> location points, case clock, with origin
GET /entities/{id}/routine              -> clusters + confidence + supporting count
```

Routine responses always carry the supporting point count. A pattern derived from
four points must be visibly a pattern derived from four points (FR-6.3).

### 2.8 Health

```
GET  /health          -> per-dependency status, no auth, safe to expose on the LAN
GET  /nodes           -> [{id, name, status, budget_dps, gpu_name, cameras, last_seen}]
POST /nodes           {name, address, budget_dps, vram_ceiling, max_batch, gpu_name,
                        status: ready|degraded}
                      -> {id, name, status, budget_dps, gpu_name, cameras, last_seen}
```

`POST /nodes` is how an engine node registers or re-registers itself after calibration
(M1-T3, D14). `status` is `degraded` when calibration measured `budget_dps` below the
quality floor; a degraded node is recorded but assigned no cameras. Re-posting with the
same `name` updates the existing row (upsert on `name`) rather than creating a duplicate.

### 2.9 Socket

`wss://{server}:8443/v1/ws?case_id=`. Server pushes ingest, review, graph sync,
candidate and node events. Client sends only `{"type":"ping"}`. All commands go
over REST so they get idempotency keys and audit rows.

### 2.10 Case timeline

```
GET /cases/{id}/timeline?type=&entity_id=&from=&to=&order=&limit=&cursor=
                                        -> {results: [{event_type, ts, clock,
                                            description, actor,
                                            entity_refs[], detail}],
                                            next_cursor}
```

Any assigned role. Merges all dateable events, newest first by default
(`order=asc` reverses): `source_files` as `file_ingested`, `evidence` as
`evidence_committed`, Re-ID candidates as `candidate_proposed`, and
`audit_log` rows as `audit_action`. `clock` is `"case"` or `"system"` on
every event and the UI must render the label, never bare timestamps
(D16): case-clock events (`evidence.occurred_at`, candidate `ts`) versus
infrastructure wall-clock (`source_files.created_at`, `audit_log.created_at`,
allowed by CLAUDE.md rule 3). Rows without any timestamp are undateable
and excluded by definition, not defaulted. `entity_id` matches events
referencing that entity (evidence edge ends, audit `object_id`); file and
candidate events carry no entity linkage in the current model and report
`entity_refs: []`. Evidence events carry their `tamper_state` in `detail`.
Pagination follows §1.3; `limit` defaults to 50, capped at 100.

### 2.11 Administration

Admin role only on all three routes. These routes are platform-scoped, so
their audit rows carry the nil UUID as `case_id` rather than inventing a
case. (The administrator also has unrestricted, unconditional read access
to case content itself — D37 amends D21 — via the case-content routes
elsewhere in this document, not through these three.)

```
GET    /admin/users                   -> [{id, email, badge_no, full_name,
                                            role, active}]
POST   /admin/users                   {id, email, badge_no, full_name, role}
                                        -> 201 + user record
PATCH  /admin/users/{id}              {active} -> user record
```

`POST` takes the GoTrue `auth.users.id` as `id`: assignment checks
and the deactivation overlay look users up by the JWT `sub`, so a
directory row with any other id would match nothing (nil id is
`422`). It further validates a non-empty email containing `@`, a
non-empty `badge_no`/`full_name`, and a known role; duplicate email
or duplicate id is `CONFLICT`.
There is no DELETE: deactivation flips `active` to false and the audit
trail survives. A bearer token for a deactivated user is rejected
`UNAUTHENTICATED` at verification, so deactivation actually locks the
account rather than labelling it. Production creates the `auth.users`
entry through the GoTrue admin API; the in-memory directory records the
admin's intent until that wiring lands (same documented follow-up as
every other store in this service).

### 2.12 Global search

```
GET /search?q=&types=&case_id=&limit=
                                        -> {entities: [], cases: [],
                                            files: [], identifiers: []}
```

Any assigned role (io, analyst, auditor), plus admin unconditionally (D37
amends D21). Without `case_id` the search spans every case the caller is
assigned to (every case, for admin); with `case_id` it narrows to that
case, which must be assigned unless the caller is admin
(`CASE_ACCESS_DENIED` otherwise — never an empty result set). `types` is
`entities|cases|files|identifiers|all`
(default `all`); unknown values are `VALIDATION_FAILED`. Empty `q`
returns empty groups, not an error.

Matching is case-insensitive substring over entity names and aliases,
case codes and titles, filenames, and identifier values — the
in-memory equivalent of the production `ILIKE` queries, which ride the
pg_trgm GIN indexes from migration `20260915000000` (plain `%q%`
`ILIKE` cannot use a btree, hence GIN). Each group is capped at 10
results, 40 total; `limit` caps the total (default 40, max 40). Every
call writes one `search.query` audit row; without `case_id` the row is
platform-scoped (nil UUID) like §2.11.

---

## 3. Client to engine node

### 3.1 Video

```
GET https://{node}:8756/stream/{camera_code}.mjpg
```

`multipart/x-mixed-replace; boundary=frame`, consumed by a plain `<img src>` (D3).
No JavaScript decoding. Auth by short-lived signed query token issued by the
server, because `<img>` cannot send an Authorization header.

### 3.2 Overlays

`wss://{node}:8756/ws/cv/{camera_code}` pushes `cv.boxes`:

```json
{
  "type": "cv.boxes",
  "case_clock_ts": "2025-11-02T14:23:07.500Z",
  "payload": {
    "camera_code": "cam_01",
    "frame_seq": 40912,
    "effective_fps": 8.4,
    "below_quality_floor": false,
    "boxes": [
      {"track_id": 7, "bbox": [412, 233, 86, 194], "conf": 0.91, "is_target": false}
    ]
  }
}
```

Boxes travel separately from pixels so overlays re-render at UI framerate and box
coordinates stay inspectable and testable. `effective_fps` and
`below_quality_floor` drive the per-feed readout and warning band (D14).

---

## 4. Server to engine node

```
POST /calibrate                 -> {budget_dps, vram_ceiling, max_batch, gpu_name,
                                     registered}
POST /cameras/attach            {camera_id, code, feed_uri, mode,
                                  declared_start_ts, fps}
POST /cameras/{code}/detach
GET  /budget                    -> current allocation per camera
POST /targets                   {target_id, embedding, source_camera, source_ts}
POST /targets/{id}/prior        {expected_from, expected_window, adjustment}
DELETE /targets/{id}
GET  /health
```

`registered` (M1-T3) reports whether the node's own `POST /v1/nodes` call to the
server (§2.8) succeeded. A server outage must not hide a real calibration
measurement behind a failed `/calibrate` call, but a failed registration still has
to be visible somewhere rather than only a log line (rule 9) -- this is that place.

`wss://{node}:8756/ws/control` pushes `cv.tracklet` and `reid.candidate` to the
server.

```json
{
  "type": "reid.candidate",
  "case_clock_ts": "2025-11-02T14:31:22.100Z",
  "payload": {
    "target_id": "…", "camera_code": "cam_03",
    "similarity": 0.681, "threshold_used": 0.655,
    "prior_adjustment": -0.045,
    "expected_from": "cam_01",
    "expected_window": ["2025-11-02T14:28:00Z", "2025-11-02T14:34:00Z"],
    "bbox": [201, 188, 74, 176],
    "crop_path": "…", "embedding": "base64…"
  }
}
```

Every field after `similarity` exists so the UI can explain the proposal (FR-5.6).
A candidate without its threshold and prior is not a valid candidate.

**Engine nodes never write to Postgres or Neo4j.** They hold read-only Bolt
credentials for camera topology queries and nothing else (D10). Persistence is the
server's job, so it passes the audit emitter.

### 4.5 Server to docs-lane (internal, :8757)

Not yet implemented as HTTP. The docs-lane currently has no HTTP
service. The server uses a trait stub (`ExtractionClient`) that returns
connection-refused gracefully.

Planned endpoints (not yet live):

```
POST /extract {text, source_node}      -> ExtractionOutput
POST /ocr (multipart, file bytes)      -> {text: string}
```

`DOCS_LANE_URL` env var, default `http://localhost:8757`.

---

## 5. Server to ledger gateway

`http://{gateway}:8801` on the loopback or a private link. The same five endpoints
are implemented by the real Fabric gateway and by the mock, which is what makes
`LEDGER_MODE=mock` a single-flag swap (D13).

```
POST /anchor          {docHash, caseId, actorLedgerId}     -> {txId, blockNo, ts}
POST /action          {actionType, payloadHash, objectId,
                        caseId, actorLedgerId}              -> {txId, blockNo, ts}
GET  /verify/{docId}                                        -> {txId, hash, ts,
                                                                 endorsements[]}
GET  /history/{objectId}                                    -> ordered tx list
GET  /health                                                -> {mode: fabric|mock,
                                                                 orgs[], peers[]}
```

`endorsements` lists the organisations that signed. With multi-org Fabric this is
the field that makes tamper-evidence meaningful, and the UI shows it (D22). In
mock mode it contains a single entry marked `mock`, and the UI must render that
differently. A mock endorsement dressed up as a real one is the exact
misrepresentation D22 exists to avoid.

---

## 6. Rules

1. Version this file with the API. Breaking changes bump `/v1` and update the
   event envelope `v`.
2. Client TypeScript types are generated from the Rust command signatures. Never
   hand-write them.
3. Never proxy video through the server.
4. Never return a candidate without `threshold_used` and `prior_adjustment`.
5. Never accept a camera registration without `declared_start_ts`.
6. Every mutating endpoint writes an audit row before returning.
