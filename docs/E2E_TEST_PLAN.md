# RAVEN — End-to-End Test Plan

Manual, click-through test plan for the whole platform. Run top to bottom to
verify a build before shipping. Mark each case **Pass / Fail / N/A** in the
Result column and note anything odd.

## How to run

```bash
npm run dev          # ONE dev server only → http://127.0.0.1:1420/
```

- **Default (`/`)** loads the new **RavenShell** (top-nav) wired to the real panes.
- **`/?legacy`** loads the old sidebar/tab console (fallback).
- **`/?refactor`** loads the static design mockup (RavenRefactor, mock data only).

**Backend dependencies** — some cases need services running; they are tagged:
- `[TAURI]` needs the Tauri desktop shell (`npm run tauri dev`) for `invoke` commands.
- `[ENGINE]` needs the CV engine at `http://127.0.0.1:8756` (YOLO/OSNet + WebSocket).
- Untagged cases work in a plain browser with the Vite dev server only.

Run untagged cases in the browser first; run `[TAURI]`/`[ENGINE]` cases in the
full desktop build. Where a service is down, the UI should **degrade gracefully**
(simulated fallback), not crash — that graceful path is itself a test case.

Environment: **⚠ run exactly one `npm run dev`.** Two servers collide on the HMR
port and cause page reloads that reset state — a known environment trap, not a bug.

---

## 1. Shell & Navigation

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| NAV-01 | Load `/` | RavenShell renders: top command bar (RAVEN mark, case `OP-RAVEN-01`, 5 numbered tabs, search, `AK` avatar, ZULU clock), canvas, status ticker | |
| NAV-02 | Click each tab 01–05 | Canvas switches to Profiles / Network / Optics / Ledger / Sources; active tab shows highlight + accent number + underline sweep | |
| NAV-03 | Watch the ZULU clock for ~30s | Time updates (HH:MM ZULU), stays current | |
| NAV-04 | Click the `search ⌃K` button | Command palette opens | |
| NAV-05 | Press `Ctrl+K` (or `⌘K`) anywhere | Command palette opens; `Esc` closes it | |
| NAV-06 | Read the status ticker (bottom) | Shows current module title + active tab title + pulsing "ALL SYSTEMS LIVE" | |
| NAV-07 | On any tab, refresh the page (`⌘R`) | App returns to the **same** module, not Profiles (persisted via localStorage) | |
| NAV-08 | Switch to Ledger, refresh, then open a private window at `/` | Ledger persists in the first; fresh/private window defaults to Profiles | |

## 2. Entry modes (gate)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| GATE-01 | Load `/` | New RavenShell (top-nav), NOT the sidebar | |
| GATE-02 | Load `/?legacy` | Old console: left sidebar ("Active Case", Modules), tab bar, status bar | |
| GATE-03 | Load `/?refactor` | Static design mockup — same look, but data is fixed/mock and action buttons are inert | |
| GATE-04 | In `?legacy`, click each sidebar module | Same 5 panes render (shared components) | |

## 3. Profiles (01)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| PRO-01 | Open Profiles | Table of 6 subjects: ## / Subject / Alias / Role-Tier / Aadhaar / Cases / Risk index / Status | |
| PRO-02 | Check role dots + risk bars | Role dot colored by tier (leader red, operator amber, logistics yellow, mule/associate grey); 10-seg risk meter filled to score, colored by band | |
| PRO-03 | Type `khan` in search | List filters to Mohd. Khan; count updates to `1/6 SUBJECTS` | |
| PRO-04 | Clear search, click role filter `LEADER` | Only Rakesh Sawant (leader) shown; `1/6 SUBJECTS` | |
| PRO-05 | Click status filter `WATCH` | Only "Under Watch" subjects shown; count updates | |
| PRO-06 | Combine `OPERATOR` + search `anita` | Anita Roy only | |
| PRO-07 | Reset filters to ALL/ALL, empty search | All 6 shown; `6/6 SUBJECTS` | |
| PRO-08 | Double-click a subject row | Opens that subject's Profile dossier tab | |
| PRO-09 | Click `+ NEW SUBJECT` | Create-profile action fires (placeholder alert acceptable in preview) | |

## 4. Network (02)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| NET-01 | Open Network | Force graph renders on a dark dotted canvas; nodes spread evenly across the frame (no clumping) | |
| NET-02 | Inspect node shapes/colors | Person = red hexagon, org = amber octagon, account = yellow hexagon, location = green diamond, vehicle = purple round-rect | |
| NET-03 | Click a person node | Node Intel panel opens: name, PRIMARY SUSPECT badge, ID, LINKS + THREAT tiles, evidence chain | |
| NET-04 | Click `✕` on the panel | Panel closes, selection clears | |
| NET-05 | Double-click a person node | Opens that person's Profile dossier tab | |
| NET-06 | Open `FILTERING OPTIONS`, toggle off Accounts | Account nodes disappear from the graph; toggle back restores | |
| NET-07 | Change `LAYOUT` dropdown (Concentric / Circle / Grid) | Graph re-lays out in the chosen pattern | |
| NET-08 | Click `RESET VIEW` | Graph fits to viewport, centered | |
| NET-09 | Use bottom-right `−` / `+` | Zoom out/in; readout `N.NN×` updates | |
| NET-10 | Select a node, click `ISOLATE 1-HOP NEIGHBORHOOD` | Non-neighbor nodes dim to ~8% opacity | |
| NET-11 | Click `EXPORT PNG` | A PNG of the graph downloads (`Raven_Macro_Graph_*.png`) | |
| NET-12 | Click `LEGEND` | Legend panel lists the 5 entity types with colors | |
| NET-13 `[TAURI]` | With backend up, open Network | `get_macro_graph` invoke resolves; no console error | |

## 5. Optics (03)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| OPT-01 | Open Optics | 3-pane layout: Detected list (left), video canvas (center), Sightings (right), topology strip (bottom) | |
| OPT-02 | Read detected list | 5 persons with confidence; `03` is the locked target (red, "TARGET LOCK-ON") | |
| OPT-03 | Click detected person `01` | `01` becomes locked target (red); `LOCK-ON TARGET 01` button updates | |
| OPT-04 | Switch camera to `CAM-03` | Feed label updates to "South Highway Tollgate" | |
| OPT-05 | Inspect video canvas | Corner brackets, timecode, REC ping, yellow bounding boxes + red LOCKED target box | |
| OPT-06 | Read topology strip | CAM-01 ACTIVE (green) → CAM-02 ARMED (yellow) → CAM-03/04 STANDBY | |
| OPT-07 | Click play/pause on transport | Icon toggles | |
| OPT-08 `[ENGINE]` | Engine down: open Optics | "EVENTS STANDBY" shown; simulated boxes render; no crash | |
| OPT-09 `[ENGINE]` | Engine up: click `START TRACKING` | `start_tracking` runs; live stream + real detection boxes appear; "EVENTS LIVE" | |
| OPT-10 `[ENGINE]` | With a session, click a person to lock | `lock_on_target` runs; lock status + tx id shown | |
| OPT-11 `[ENGINE]` | When a downstream sighting arrives, click `CONFIRM` / `REJECT` | `confirm_sighting` runs; outcome + tx id recorded on the card | |
| OPT-12 `[ENGINE]` | Click `STOP TRACKING` | Session ends; boxes clear | |

## 6. Ledger (04)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| LED-01 | Open Ledger | 4 stat tiles: Total 2,847 / Verified 2,831 (green) / Pending 14 (amber) / Tampered 2 (red, blinking) | |
| LED-02 | Read the ledger table | 5 rows; consensus badge "CONSENSUS HEALTHY · RAFT" | |
| LED-03 | Find the tampered row (`suspect_wiretap_log_audio.wav`) | Red row + red left edge, `✕ TAMPERED` status | |
| LED-04 | Click the tampered row | Inspector shows TAMPERED badge, ledger anchor hash (green) vs current storage hash (red, `(MISMATCH)`) | |
| LED-05 | Click a verified row | Inspector shows VERIFIED, both hashes match (green) | |
| LED-06 | Read chain of custody | 3 timeline events (Ingested / On-Chain Anchor / NER Run) with accent dots + block # | |
| LED-07 `[TAURI]` | Backend up, open Ledger | `get_audit_log` invoke resolves; no console error | |

## 7. Sources (05)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| SRC-01 | Open Sources | Header "Data Sources" + summary; 4 store cards (Postgres, Neo4j, Storage, Fabric Ledger) | |
| SRC-02 | Check store health dots | S1/S2/S3 = LIVE (green), S4 Fabric Ledger = DEGRADED (amber) | |
| SRC-03 | Click a store card | Expands to data-integrity checks (pass/warn/fail) + last sync time | |
| SRC-04 | Expand Fabric Ledger (S4) | Shows a `fail` check (peer down → mock fallback) | |
| SRC-05 | Read the upload pipeline | 6 stages in sequence: Hash & register → Parse → Map → Store → Isolate → Commit & anchor | |
| SRC-06 | Click `↑ UPLOAD CSV/PDF` / `+ CONNECT DATABASE` | Action fires (real handler in full build; visual in preview) | |
| SRC-07 `[TAURI]` | Backend up: run the real upload/ingest flow | CSV parsed, rows stored, source_files row created, ledger anchor emitted | |

## 8. Responsive & theme

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| RSP-01 | Resize the window to ~900px wide | Inactive nav labels collapse to their number; active tab keeps its label | |
| RSP-02 | At ~900px, confirm all 5 tabs reachable | Ledger + Sources still clickable; no horizontal page scroll | |
| RSP-03 | Widen back to ≥1300px | Labels return; layout normal | |
| THM-01 | Scan all 5 tabs | Consistent dark theme (`#060809`), yellow accent, Instrument Sans + Spline Sans Mono; no leftover blue `pd-*` styling | |
| THM-02 | Check hover states | Rows/buttons highlight on hover; focus rings on inputs | |

## 9. Backend integration `[TAURI]` `[ENGINE]`

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| BE-01 `[TAURI]` | Launch `npm run tauri dev` | App boots in the desktop shell; no invoke errors on load | |
| BE-02 `[TAURI]` | Exercise each module that calls `invoke` | macro graph, audit log, tracking, lock, confirm all resolve | |
| BE-03 `[ENGINE]` | Start the CV engine, open Optics | WebSocket connects ("EVENTS LIVE"); detections stream | |
| BE-04 | Kill a backend mid-session | UI degrades gracefully (standby / simulated), no white screen or uncaught error | |

## 10. Regression / smoke

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| REG-01 | Open DevTools console, click through all 5 tabs | No red errors (a down `:8756` WebSocket warning is expected when the engine is off) | |
| REG-02 | `npm run build` | `tsc` + Vite build succeed with no type errors | |
| REG-03 | Rapidly switch tabs 10× | No leaks, no stuck state, graph/video re-init cleanly | |
| REG-04 | Confirm `/?legacy` still fully works | Old console usable as a fallback | |

---

## Sign-off

| Field | Value |
|-------|-------|
| Build / commit | |
| Tester | |
| Date | |
| Browser / OS | |
| Backend (Tauri / Engine) run? | |
| Overall result | Pass / Fail |
| Blocking issues | |

> Known non-blocking notes: `?refactor` mockup is design reference only (inert
> buttons, mock data). Old `App.tsx` + sidebar serve only `?legacy` and will be
> retired once the new shell is signed off.
