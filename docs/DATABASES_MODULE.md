# Databases Module ("Data Sources" tab)

**Feature branch:** `feature/databases-module` · **PR:** #2 → `main`
**Status:** UI + mock data complete and verified. Real backend wiring is a follow-up.

This document explains **what** was built, **why**, and **how** (the logic behind each
piece), so it can be reviewed without reading the code line by line.

---

## 1. What this feature is

Raven stores its intelligence data across **four separate systems**, each specialised for
a different job:

| Store | Role | Where it runs |
|-------|------|---------------|
| **Supabase Postgres** | Relational tables (people, cases, transactions) — 19 tables | Cloud |
| **Neo4j** | The criminal-network *graph* (who is connected to whom) | Local Docker |
| **Supabase Storage** | Evidence blobs (scanned FIR PDFs, images) | Cloud bucket |
| **Fabric Ledger** | Tamper-proof audit anchors (proves evidence was not altered) | Local / mock |

Before this feature, there was **no screen** to see or manage these stores — they ran
invisibly in the background.

This feature adds a new **"Databases"** item in the left sidebar. Clicking it opens a
**Data Sources** tab that lets an analyst:

1. **See all connected databases** — each with a live health indicator, a data-integrity
   score, and record counts.
2. **Connect a new database** — register an external source by URL and tag what kind of
   data it holds.
3. **Upload a CSV/PDF** — push a file through the ingest pipeline, which maps its rows into
   Raven's existing schema and isolates anything it does not recognise.

---

## 2. Requirements → implementation

These are the answers the team leader gave, and how each was met.

| Requirement (from team leader) | How it was implemented |
|-------------------------------|------------------------|
| "A new section like Profiles / Graph / Logs" | New `databases` nav item + tab, dispatched exactly like the existing modules. |
| "Check all existing databases' health and data integrity" | Store cards show a health dot (Live / Degraded / Down) + an integrity %; expanding a card lists per-store integrity checks. |
| "Option to connect new DBs — take the URL and select the info category (financial, vehicle, etc.)" | **Connect Database** modal: URL field + category dropdown (7 predefined categories) + Test connection. |
| "Add CSVs and PDFs which go into our data upload pipeline" | **Upload CSV/PDF** modal runs the file through a 6-stage pipeline with live progress. |
| "See how new data can be stored properly in our existing schema; isolate completely new information" | Each category maps to a real target table; unmapped columns are surfaced in an **Isolated** list for human review. |
| "For testing we will need mock data" | All data comes from `src/dev/mockDatabases.ts`; the module renders fully in `npm run dev` with no backend running. |

---

## 3. Architecture & files

The app uses a **tab-based workspace**: the sidebar sets an `activeNav`, which opens a
`WorkspaceTab`; `App.tsx` renders a pane based on the active tab's `type`. This feature
plugs into that existing pattern — nothing bespoke.

### New files
- **`src/components/databases/DatabasesPane.tsx`** — the whole module: the Data Sources
  pane plus the two modals (Connect Database, Upload).
- **`src/dev/mockDatabases.ts`** — all mock data (the four stores, integrity checks,
  categories, pipeline stages) and the deterministic pipeline simulator.

### Modified files (wiring only)
- **`src/store/case.ts`** — added `"databases"` to the tab-`type` union and the `activeNav`
  union; `setActiveNav("databases")` opens the `Data Sources` tab.
- **`src/components/Sidebar.tsx`** — added the "Databases" nav button (database icon,
  "4 DBs" badge).
- **`src/App.tsx`** — added `activeTab.type === "databases"` → `<DatabasesPane />`.

### Why the split (data vs. UI)
All numbers and behaviour live in `mockDatabases.ts`, separate from the React component.
This is deliberate: when the real backend is ready, only that one file is swapped for calls
to `invokeRaven(...)` (the app's existing command bridge). The UI does not change.

---

## 4. The logic, piece by piece

### 4.1 Store inventory & health

`CONNECTED_STORES` is an array of store descriptors, each with a `health` state
(`up` / `degraded` / `down`) and an `integrity` percentage (0–100).

- **Health** renders as a coloured dot: green (up), amber (degraded), red (down). The
  green dot pulses to read as "live".
- **Integrity %** is colour-coded by threshold — `≥99` green, `≥85` amber, else red — via
  the `integrityColor()` helper.
- The header aggregates these: *"X/Y stores live · Z% avg integrity"*, recomputed with a
  `useMemo` whenever the store list changes (so a newly connected DB updates the totals
  immediately).

### 4.2 Data-integrity checks (expandable)

`INTEGRITY_CHECKS` lists checks keyed by `storeId`, each with a state
(`pass` / `warn` / `fail`) and a human-readable detail. Clicking a store card toggles
`expanded`; the panel filters the checks for that store and lists them with matching
coloured dots. Examples: *"Schema present (19/19 tables) — pass"*, *"source_files ↔ Storage
blob parity — 87/87 matched"*, *"Gateway reachable — fail (peer down, mock fallback)"*.

These mirror the *real* integrity concerns from the architecture (foreign-key orphans,
blob SHA-256 round-trip, Neo4j↔Postgres id sync, ledger anchor coverage) — so when live
data replaces the mock, the same checks map onto real queries.

### 4.3 Categories → schema mapping (the "store it properly" logic)

`DATA_CATEGORIES` is the heart of "store new data in our existing schema". Each category
maps an incoming data type to (a) the real `source_node` enum value from the DB migration,
and (b) the **target table** rows should land in:

| Category | `source_node` | Target table |
|----------|---------------|--------------|
| Financial | `CFCFRMS` | `financial_txns` |
| Vehicle | `VAHAN` | `entities` · `identifiers` |
| Telecom / CDR | `TELECOM` | `cdr_records` |
| Identity / Biometric | `NAFIS` | `entities` · `identifiers` |
| Case / FIR | `CCTNS` | `source_files` · `cases` |
| Location | `MANUAL` | `location_history` |
| Other / Unclassified | `MANUAL` | `isolated` |

These are **not invented** — they come straight from `infra/migrations/001_init.sql`
(`CREATE TYPE source_node AS ENUM (...)` and the table definitions). That grounding is
what lets an uploaded file be routed to the right place automatically.

### 4.4 Connect Database modal

Fields: optional display name, **connection URL** (required), and **category**.

- **Test connection** (`runTest`): a mock check — a URL that looks structurally valid
  (`scheme://host…`) reports "Connection OK" after a short delay; otherwise "Unreachable".
  In the real version this becomes a backend ping.
- **Add source** is disabled until a test passes. On submit, the URL's host is parsed and a
  new store card is appended (health `up`, `0 rows · pending first sync`) with its role set
  to *"{category} source → {target table}"*.
- **Security note:** the form intentionally takes **only the URL**, never a password. Copy
  under the field states credentials stay in `.env`. This registers an *endpoint*, not a
  secret — matching Raven's "no credentials in the UI" posture.

### 4.5 Upload pipeline (the "store all in sequence" logic)

The six stages (`PIPELINE_STAGES`) mirror Raven's real ingest saga:

```
Hash & register → Parse & extract → Map to schema → Store rows → Isolate unmapped → Commit & anchor
```

- **Hash & register** — SHA-256 the file, create a `source_files` row.
- **Parse & extract** — read CSV columns, or OCR + NER a PDF.
- **Map to schema** — match each field to the target table for the chosen category.
- **Store rows** — insert into Postgres (+ upload blob to Storage).
- **Isolate unmapped** — park any column the schema does not recognise for human review.
- **Commit & anchor** — write the ledger anchor and emit an audit event.

**Progress logic:** when the user clicks *Run pipeline*, a `setInterval` advances
`activeStage` one step every 500 ms. Completed stages show a green ✓, the current stage a
spinner, upcoming stages a number. When the last stage finishes, the interval clears and
the result is computed.

**The result** comes from `runIngest(fileName, categoryId, csvText?)`.

**CSV — real parsing (not mocked).** When the uploaded file is a `.csv`, the modal reads
its actual text (`file.text()`) and passes it to `runIngest`, which:
1. Parses the real header + data rows with `parseCsv()` — a small RFC-4180-style parser that
   handles quoted fields, escaped quotes (`""`), and commas inside quotes.
2. Matches **each real header** against the target table's columns for the chosen category,
   using `SCHEMA_FIELDS` — a per-category map of canonical columns (from
   `001_init.sql`) plus accepted aliases (so `amount_inr` → `amount`, `date` → `ts`,
   `method` → `channel`, etc.). Matching is tolerant (lowercased, non-alphanumerics
   stripped).
3. Any header with no schema home is **isolated**, and its sample value is taken from the
   **first non-empty cell in that column** of the real data.

So the counters are genuine: **Rows detected** = actual data-row count; **Columns mapped** =
headers that matched the schema (shown as `header → target_column`); **Columns isolated** =
headers with no home (shown with a real sample value).

Worked example — the 8-column `sample_financial.csv` (5 rows), category *Financial*:
`txn_id→id`, `date→ts`, `from_account→from_account`, `to_account→to_account`,
`amount_inr→amount`, `method→channel` map (6); `beneficiary_pan`, `gst_ref` isolate (2).

The **"Other"** category maps nothing — every column is isolated. This is the "completely
new information we will isolate for now" requirement made concrete.

**PDF — still a stub.** A `.pdf` has no client-side text layer here, so it is ingested as a
single document (real OCR + NER is the backend follow-up). It reports 1 row detected and, for
non-"Other" categories, 1 doc mapped.

---

## 5. How to try it

```bash
npm install       # first time only
npm run dev       # opens http://127.0.0.1:1420
```

1. Click **Databases** in the left sidebar.
2. Expand any store card to see its integrity checks.
3. **Connect Database** → paste e.g. `postgresql://vahan.gov.in:5432/registry`, pick
   *Vehicle*, Test connection, Add source → a new card appears and the header totals update.
4. **Upload CSV/PDF** → choose a file, pick a category, Run pipeline → watch the six stages,
   then read the Detected / Mapped / Isolated result.

No backend (Neo4j, engine, Supabase) needs to be running — the module uses mock data.

---

## 6. Verification done

- `npx tsc --noEmit` — passes clean (0 errors).
- No browser console errors on load or during any interaction.
- End-to-end in the browser: connected a test DB (header moved 3/4 → 4/5 live) and ran
  `tools/sample_financial.csv` (Financial) through the full pipeline — real parse reported
  *5 rows detected / 6 columns mapped / 2 columns isolated*, with the mapped `header → column`
  list and `beneficiary_pan` / `gst_ref` isolated with real sample values.
- A sample CSV lives at `tools/sample_financial.csv` for re-testing.

---

## 7. Limitations & next steps

This is a **front-end + mock** layer. Explicitly **not** done yet:

1. **Live health** — the store dots are mock. Replace with the real `health_check` command
   (already exists) reporting supabase/neo4j/fabric/python status.
2. **Real integrity checks** — swap the static `INTEGRITY_CHECKS` for actual queries
   (FK-orphan count, blob SHA parity, ledger coverage).
3. **Real connect** — Test connection should ping the backend; Add source should persist
   the registration (and never handle secrets — those stay in `.env`).
4. **Real ingest** — wire the Upload modal to the existing ingest saga
   (`invokeRaven`) so files are genuinely hashed, stored, and anchored server-side.
   *(CSV header→column mapping is already real and client-side; what remains is
   actually persisting the parsed rows and OCR/NER for PDFs.)*

Because all state lives in `src/dev/mockDatabases.ts`, each of these is a localized swap;
the component and its layout stay as-is.
