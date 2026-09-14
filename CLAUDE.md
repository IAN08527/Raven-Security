# CLAUDE.md

Repo-root instructions. Loaded automatically every session. Read this before
touching anything.

Raven is a criminal network analysis platform for law enforcement. It ingests case
documents, communication and financial records, and camera footage; extracts the
entities and relationships inside them; and presents a network where every link
traces back to the evidence that produced it. Everything runs on premises with no
third-party network calls.

This tool can contribute to someone being investigated or detained. That is the
reason for most of the rules below. Where a rule looks inconvenient, it is
protecting against a specific harm, and the harm is named.

---

## Hard rules

These encode decisions that are easy to break silently. Breaking one is a bug even
when the code works and the tests pass. If a task appears to require breaking one,
stop and say so rather than proceeding.

1. **Never auto-confirm an identity.** Cross-camera matches and entity merges are
   proposals with `status='proposed'`. A human confirms before anything enters a
   case record, the graph or the map. There is no code path that skips this, no
   config flag that disables it, and no "auto-confirm above 0.95" shortcut.
   (D9, FR-5.7)

2. **Only the server writes to Neo4j.** Engine nodes and the document lane hold
   read-only Bolt credentials. Every graph mutation goes through the server saga so
   it passes the audit emitter. (D10)

3. **Never use `now()` for case data.** All timestamps relating to sources,
   detections, tracklets, sightings and candidates derive from the case clock:
   `declared_start_ts + offset`. System time is valid only for infrastructure
   logging and audit rows. (D16)

4. **Metrics never touch synthetic rows.** Everything under `eval/` filters
   `provenance IN ('benchmark','collected')`, enforced in the harness rather than
   left to the caller. (D19)

5. **Migrations are additive after the baseline.** Never edit an applied migration.
   Never drop a column that holds data. `supabase db reset` is safe today and
   destructive from M6 onward.

6. **No third-party network calls anywhere in the pipeline.** No hosted model APIs,
   no map tile servers, no telemetry, no CDN fonts. The CI egress test fails the
   build on any of these. If a library phones home, replace the library.

7. **Provenance propagates.** Anything derived from a source file inherits its
   provenance value. Losing it in a join or an insert is a bug. (D19)

8. **Every extracted value keeps its span.** Entities and relationships point back
   to source file, page and character offsets. An extraction that cannot be traced
   to its source is not shippable. (FR-4.4)

9. **Fail into a visible queue, never a silent drop.** Recognition failures,
   extraction failures and low-confidence fields go to a review queue with a stated
   reason. Empty results and swallowed exceptions are both bugs.

10. **Do not invent numbers.** Performance figures, thresholds and error rates come
    from `docs/RESULTS.md`. If a value is not measured yet, leave the placeholder
    and say so. Never write a plausible-looking benchmark into a document, a
    comment or a default.

---

## Layout

```
docs/          PRD.md ARCHITECTURE.md DECISIONS.md EVALUATION.md
               API_CONTRACTS.md STACK.md BUILD_PLAN.md RESULTS.md
client/        Tauri desktop. src/ React, src-tauri/ Rust.
server/        Rust. Orchestration, saga, auth, sole graph writer.
engine/        Python. Camera node: decode, detect, track, embed.
docs-lane/     Python. Server side: prepare, segment, script ID, recognise, extract.
ledger/        Node. Chaincode, gateway, mock.
infra/         compose profiles, Fabric network, Neo4j bootstrap.
supabase/      migrations/ is the only place schema changes live.
eval/          Harness, fixed splits, metric scripts.
tools/         Dataset download and preparation.
```

## Which document to read

Do not load all of `docs/` at once. Read what the task needs.

| Task | Read |
|:---|:---|
| Anything | this file |
| Adding or changing a feature | `PRD.md`, find the FR |
| Structural or cross-service work | `ARCHITECTURE.md` |
| "Why is it done this way" | `DECISIONS.md`, search the decision id |
| Crossing a service boundary | `API_CONTRACTS.md` |
| Adding a dependency | `STACK.md` |
| Metrics, datasets, thresholds | `EVALUATION.md` |
| Picking up work | `BUILD_PLAN.md` |

Code comments reference decision ids, for example
`// D15: topology modulates the threshold, it does not gate execution`.
When changing behaviour governed by a decision, update `DECISIONS.md` in the same
change, marking the old decision superseded rather than deleting it.

---

## Commands

```bash
# Database
supabase start                     # Postgres 54322, Studio 54323
supabase db reset                  # replays all migrations, destroys data
supabase migration new <name>      # never edit an existing migration

# Services
docker compose -f infra/compose/all-in-one.yml up -d
docker compose exec neo4j cypher-shell -f /import/bootstrap.cypher

# Build and test
cargo test --workspace
cargo clippy -- -D warnings
cd client && npm run build         # tsc + vite, must be clean
pytest engine/ docs-lane/
ruff check . && mypy engine docs-lane

# Evaluation
python eval/run_all.py             # appends a row to docs/RESULTS.md
python eval/run_all.py --fast      # CI subset
pytest eval/test_no_egress.py      # must pass, no exceptions
```

---

## Conventions

**Rust.** `thiserror` in libraries, `anyhow` at boundaries. No `unwrap()` or
`expect()` outside tests and startup. Saga steps are individually retryable and
idempotent.

**Python.** Type hints throughout, `mypy` clean. Pydantic at every model boundary,
including internal ones. No bare `except`.

**TypeScript.** `strict: true`, no `any`. Types crossing the Rust boundary are
generated, not hand-written.

**SQL.** Every foreign key indexed. Every content table carries `provenance`. Case
data is always read through RLS; application code never uses a service-role key.

**Errors.** Every service returns the envelope defined in `API_CONTRACTS.md`. No
service invents its own error shape.

**Tests.** New logic ships with tests. Anything touching RLS ships with a test
proving cross-case access is denied. Anything touching the case clock ships with a
test using a declared start time that is not today.

---

## Working style

- One task at a time from `BUILD_PLAN.md`, with its acceptance criteria checked
  before moving on.
- Read the existing code before adding to it. Much of the client exists already
  from the prototype and is reusable.
- When a requirement is ambiguous, ask rather than choosing. A wrong choice here
  propagates into stored data and is expensive to unpick.
- When you find a bug outside the current task, note it, do not fix it in the same
  change.
- Prefer boring, obvious code. People will read this trying to work out why the
  system reached a particular conclusion.

## Things that look like improvements but are not

- Caching graph query results. Staleness in an investigative tool is a correctness
  problem, not a performance win.
- Auto-confirming high-confidence matches. See rule 1.
- Relaxing a threshold to make a demo look better. Thresholds change only with a
  new measured result in `RESULTS.md`.
- Adding a hosted model API "just for now". See rule 6.
- Generating synthetic data to fill a gap in a benchmark. See rule 4 and D19.
- Widening an RLS policy to make a query work. The query is wrong, not the policy.
