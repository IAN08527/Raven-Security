# RAVEN UI Refactor

A ground-up visual refactor of the RAVEN operator console, ported from the Claude
Design canvas project **"RAVEN Refactor.dc.html"** into a self-contained React
component at `src/refactor/RavenRefactor.tsx`. It is mounted as the app entry
(`src/main.tsx`) so the whole team can navigate every module and review the new look.

> **Scope:** This is a **visual preview**. All data is mock/static and baked into the
> component. Backend wiring (real queries, live cameras, ledger, uploads) is
> intentionally out of scope for this pass. The previous production shell
> (`src/App.tsx` + panes) is untouched — restore it by reverting `main.tsx`.

---

## Design language

| Aspect | Value |
| --- | --- |
| Base background | `#060809` (near-black) with `#080b0e` chrome surfaces |
| Default accent | `#e8c15a` (yellow) — was cyan `#8fd8ea` in the original canvas |
| Accent palette (canvas options) | `#8fd8ea` cyan · `#e8c15a` yellow · `#b6e87f` green · `#ff9e7a` coral |
| Semantic colors | red `#ff5a3c` (threat/tamper) · amber `#e0a63d` (watch/warn) · green `#5ecf9a` (healthy/verified) · purple `#b18cff` (vehicle) |
| Body font | Instrument Sans |
| Mono font | Spline Sans Mono (labels, codes, metrics) |
| Motif | Sharp corners, hairline `#1b212b` borders, uppercase mono micro-labels, clipped-corner "signal" chips, animated pulse/ping/sweep/scan accents |

Changing the `AC` constant at the top of `RavenRefactor.tsx` re-themes the whole UI.
A few decorative bits (camera bounding boxes, scanline texture) stay faint cyan by
design — they are literal, not accent-driven.

---

## Global shell

Three fixed regions wrap every module:

### Top command bar (48px)
- **Brand** — clipped-corner mark + `RAVEN` wordmark.
- **Case chip** — active case `OP-RAVEN-01` with a pulsing green "case live" dot.
- **Module nav** — five numbered tabs (`01`–`05`). Active tab gets a highlighted
  background, accent number, and an animated underline sweep. Clicking switches the
  canvas below. At narrow widths (`<1150px` in the canvas source) inactive labels
  collapse to just their number.
- **Search button** — mono `›_ search` field with a `⌃K` shortcut hint (visual only in
  this preview).
- **Operator** — `AK` avatar (IO A. Kumar) + live **ZULU** clock, refreshed every 15s.

### Canvas
Fills remaining height. A faint scanline **texture** overlay (`pointer-events:none`)
sits on top for the CRT/surveillance feel. Exactly one module renders at a time.

### Status ticker (28px)
- Left: current module title + entity tally (`14 PERSONS · 6 ORGS · 8 ACCOUNTS`).
- Right: pulsing **ALL SYSTEMS LIVE** indicator + **HEALTH BOARD** link.

---

## Tab 01 — PROFILES (Subject Roster)

The syndicate roster as a dense forensic table.

**Toolbar**
- **Search input** (`/` prefix) — live filters rows by name, alias, or Aadhaar.
- **Role filter** segmented control — `ALL · LEADER · OPERATOR · LOGISTICS · OTHER`;
  active segment tints to the accent.
- **Count** — `N/6 SUBJECTS`, updates with the filters.
- **+ NEW SUBJECT** — primary action (visual).

**Table columns**
`## · SUBJECT · ALIAS · ROLE/TIER · AADHAAR · CASES · RISK INDEX · STATUS`
- **Role/Tier** — clipped-corner dot color-coded by role (leader = red, operator =
  amber, logistics = accent, other = grey).
- **Risk index** — a 10-segment bar meter (filled = risk score) plus the numeric score,
  colored by band (HIGH red / MED amber / LOW green).
- **Status** — `ACTIVE SUSPECT` / `UNDER WATCH` / `DETAINED`, color-coded.
- Footer hint: `DBL-CLICK ROW → OPEN DOSSIER` and pagination.

*Interactive:* search box, role filters. *Static:* row open, new subject.

---

## Tab 02 — NETWORK (Macro Network)

Force-style link-analysis graph of the whole case, drawn as inline SVG.

- **21 nodes / 31 edges** across five entity types, each with a distinct polygon shape
  and color: PERSON (red hexagon), ORGANIZATION (amber octagon), ACCOUNT (accent
  hexagon), LOCATION (green diamond), VEHICLE (purple diamond).
- Person nodes are larger with labels above; other nodes label below. Edge thickness
  encodes link weight.
- **Click a node** → opens the **Node Intel** panel on the right:
  - Name, entity-type badge, and ID.
  - **LINKS** (degree) and **THREAT %** stat tiles.
  - **Evidence chain** — timestamped log entries (LOG-0842…) tied to the node.
  - Actions: **OPEN FULL DOSSIER** and **ISOLATE 1-HOP NEIGHBORHOOD** (visual).
  - `✕` clears the selection.
- **Layer toggles** (top-left) — SUSPECTS / ORGS-FIR / ACCOUNTS / VEHICLES (visual).
- **Controls** — RESET, EXPORT PNG (top-right); zoom readout + `− / +` (bottom-right).
- **Legend** (bottom-left) explains the shape/color scheme.

*Interactive:* node selection + intel panel. *Static:* layer toggles, zoom, export.

---

## Tab 03 — OPTICS (CCTV Live Monitor)

A three-pane surveillance / re-identification workspace.

**Left — Detections (250px)**
- `DETECTED · 5` with model badge `YOLOv8n`.
- Person cards `01`–`05` with detection state + confidence. Clicking one becomes the
  locked target (`TARGET LOCK-ON`, red), the rest read `PEDESTRIAN`.
- **⌖ LOCK-ON TARGET NN** button reflects the current selection.

**Center — Video canvas**
- Camera switcher `CAM-01`–`CAM-04`, live-feed label, `LIVE 1080p 30fps` and
  `YOLOv8 + OSNet RE-ID` badges, **▸ START TRACKING**.
- Simulated feed: corner brackets, timecode + `REC` blink, and detection bounding
  boxes — including a pulsing red **TARGET 03·98 / LOCKED** box.
- Transport bar: play, timecode `00:02:15 / 00:05:00`, scrubber, `1.0× · 30FPS`.

**Right — Sightings (250px)**
- `SIGHTINGS · 0` with `OSNet` badge; empty-state prompt to lock a target to arm
  cross-camera handoff; `RE-ID CONF 92.4%`.

**Bottom — Camera topology (52px)**
- CAM-01 ACTIVE → CAM-02 ARMED → CAM-03/04 STANDBY, with estimated hop distances.

*Interactive:* target lock-on, camera switch. *Static:* tracking, transport.

---

## Tab 04 — LEDGER (Audit Ledger)

Tamper-evident evidence ledger on Hyperledger Fabric.

**Stat header (4 tiles)**
`TOTAL ENTRIES 2,847` · `VERIFIED HASHES 2,831` · `PENDING ANCHOR 14` ·
`TAMPERED EVIDENCE 2` (red, blinking) — hash-mismatch alarm.

**Ledger table**
`ID · FILENAME · SHA-256 · BLOCK · STATUS · ACCESSED BY`. Rows are color-flagged:
verified (`✓` green), pending (`◌` amber), tampered (`✕` red row + red left edge).
Consensus badge reads `CONSENSUS HEALTHY · RAFT`. **Click a row** to inspect it.

**Verification inspector (right, 330px)**
- Status badge + filename, size, block.
- **SHA-256 comparison** — ledger anchor vs. current storage. For a tampered file the
  current hash renders red with `(MISMATCH)`.
- **Chain of custody** — timeline: ingested → on-chain anchor → NER extraction run.

*Interactive:* row selection drives the inspector.

---

## Tab 05 — SOURCES (Data Sources)

Health and topology of every connected data store.

**Header** — `Data Sources`, a `4/4 STORES LIVE · 94% AVG INTEGRITY` summary, and
**↑ UPLOAD CSV/PDF** / **+ CONNECT DATABASE** actions (visual).

**Connected stores** (2-column grid) — S1 Supabase Postgres, S2 Neo4j Graph,
S3 Supabase Storage, S4 Fabric Ledger. Each card shows a health dot (LIVE / DEGRADED /
DOWN), role + location, integrity %, and record count. **Click a card to expand** its
**data-integrity checks** (pass/warn/fail with detail) and last-sync time. S4 is
`DEGRADED` and demonstrates the fail state (peer down → mock fallback).

**Upload pipeline** — the six-stage ingest sequence every file flows through:
1. **Hash & register** — SHA-256 stream, `source_files` row.
2. **Parse & extract** — CSV columns / PDF OCR + NER.
3. **Map to schema** — match fields to target table.
4. **Store rows** — Postgres + Storage blob.
5. **Isolate unmapped** — park unknowns for review.
6. **Commit & anchor** — ledger anchor + audit emit.

*Interactive:* expand/collapse store cards.

---

## Running it

```bash
npm run dev        # serves on http://127.0.0.1:1420/
```

Only run **one** dev server. Two concurrent `vite` instances collide on the HMR port
(1421), which makes one page auto-reload and reset the active tab back to Profiles —
that is an environment issue, not a UI bug.

## Files

| File | Role |
| --- | --- |
| `src/refactor/RavenRefactor.tsx` | The entire refactor UI + mock data |
| `src/main.tsx` | Mounts `RavenRefactor` as the app entry |

## Restoring the production shell

Point `src/main.tsx` back at `./App` (`import App` / render `<App />`) to return to the
sidebar + tab-bar production console.

---

## Recommendations / open decisions

1. **This is a mockup with its own hardcoded data — it shadows the real app.**
   Two copies of the UI will drift (mock store names, counts, pipeline steps vs. the
   real panes). Decide the fork before it rots:
   - **Preview only** — hide behind a flag (e.g. `?refactor` URL param or env var) so the
     real `App` stays the default; never ship it as the entry on `main`.
   - **Adopt (preferred)** — keep only the shell + styling (top command bar, numbered
     nav, palette, fonts, status ticker) and mount the **real** panes
     (`ProfilesDirectoryPane`, `GraphPane`, `VisionPane`, `AuditPanel`, `DatabasesPane`)
     inside the new frame. Reuses real logic + backend instead of duplicating it; drops
     the refactor from ~700 lines to a thin shell.

2. **Fix the narrow-width nav overflow.** Below ~1000px, Ledger + Sources fall off the
   header and become unreachable. Port the source design's collapse-to-number behavior
   for inactive tabs (~5 lines). See QA Finding 2.

3. **Move colors to design tokens.** The palette is hardcoded hex throughout
   (`#e8c15a`, `#ff5a3c`, …). Lift it into `tailwind.config.js` (alongside the existing
   `pd-*` tokens) or CSS variables so retheming happens in one place.

4. **Clean up stray git files** before the PR — untracked `src-tauri/Screenshot ….png`
   and `tools/sample_cdr.csv` should be `.gitignore`d or removed so they aren't committed
   by accident.

5. **One dev server only.** Two concurrent `vite` instances collide on the HMR port and
   cause page reloads that reset the active tab. Use port 1420, single server.
