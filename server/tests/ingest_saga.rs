//! M4-T2. Ingest saga steps 7-9 tests (D4, D5, rules 3/7/8).
//!
//! No live Postgres or Neo4j here: fakes implement the saga traits and
//! record an event log, which is what proves commit-before-graph order
//! and no-rollback-on-graph-failure. Database-level enforcement itself
//! is covered by `ingest_constraints.rs` against the migration text
//! (M2 precedent); live-DB execution is CI's job with supabase up.
//! Every timestamp below is a fixed literal -- no test uses `now()`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use server::saga::ingest::{
    CaseDb, ExtractionClient, ExtractionFailure, ExtractionResult, FileStatus, GraphEdge,
    GraphError, GraphNode, GraphWriter, IngestInput, LedgerAnchor, LedgerError, LedgerOutcome,
    PersistBatch, PersistError, PersistedIds, Provenance, RawEntity, RawIdentifier,
    RawRelationship, ReviewDisposition, StepOutcome, WeightError, WEIGHT_PARAMS_VERSION,
    extraction_hash, run_steps_7_to_9,
};
use time::macros::datetime;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SagaEvent {
    ExtractCalled,
    PgCommitted,
    Neo4jMerge,
    WeightRecomputed { version: i32 },
    LedgerAnchored,
    FileStatusSet(FileStatus),
}

#[derive(Debug, Clone)]
struct StoredEntity {
    provenance: Provenance,
    sync_pending: bool,
}

#[derive(Debug, Clone)]
struct StoredRelationship {
    provenance: Provenance,
    sync_pending: bool,
}

type SharedLog = Rc<RefCell<Vec<SagaEvent>>>;

struct FakeDb {
    log: SharedLog,
    entities: HashMap<Uuid, StoredEntity>,
    relationships: HashMap<Uuid, StoredRelationship>,
    statuses: HashMap<Uuid, FileStatus>,
    fail_persist: bool,
    known_weight_versions: Vec<i32>,
    weight_calls: Vec<(Uuid, i32)>,
}

impl FakeDb {
    fn new(log: SharedLog) -> Self {
        Self {
            log,
            entities: HashMap::new(),
            relationships: HashMap::new(),
            statuses: HashMap::new(),
            fail_persist: false,
            known_weight_versions: vec![WEIGHT_PARAMS_VERSION],
            weight_calls: Vec::new(),
        }
    }
}

impl CaseDb for FakeDb {
    fn persist_extraction(
        &mut self,
        _file_id: Uuid,
        _case_id: Uuid,
        provenance: Provenance,
        batch: PersistBatch,
    ) -> Result<PersistedIds, PersistError> {
        if self.fail_persist {
            return Err(PersistError::Failed("disk is full".to_string()));
        }
        // Application-level mirror of the migration constraints: no row
        // without provenance, no evidence without spans. The database
        // enforces the same independently (ingest_constraints.rs).
        let mut entity_ids = Vec::new();
        for _ in &batch.entities {
            let id = Uuid::new_v4();
            self.entities.insert(
                id,
                StoredEntity { provenance, sync_pending: false },
            );
            entity_ids.push(id);
        }
        let mut relationship_ids = Vec::new();
        for _ in &batch.relationships {
            let id = Uuid::new_v4();
            self.relationships.insert(
                id,
                StoredRelationship { provenance, sync_pending: false },
            );
            relationship_ids.push(id);
        }
        for evidence in &batch.evidence {
            assert!(evidence.char_end >= evidence.char_start, "spans enforced pre-commit");
        }
        self.log.borrow_mut().push(SagaEvent::PgCommitted);
        Ok(PersistedIds { entity_ids, relationship_ids })
    }

    fn set_file_status(&mut self, file_id: Uuid, status: FileStatus) {
        self.statuses.insert(file_id, status);
        self.log.borrow_mut().push(SagaEvent::FileStatusSet(status));
    }

    fn recompute_weight(&mut self, rel_id: Uuid, version: i32) -> Result<f64, WeightError> {
        self.weight_calls.push((rel_id, version));
        self.log.borrow_mut().push(SagaEvent::WeightRecomputed { version });
        if self.known_weight_versions.contains(&version) {
            Ok(10.0)
        } else {
            Err(WeightError::UnknownVersion(version))
        }
    }

    fn mark_sync_pending(&mut self, entity_ids: &[Uuid], relationship_ids: &[Uuid]) {
        for id in entity_ids {
            if let Some(row) = self.entities.get_mut(id) {
                row.sync_pending = true;
            }
        }
        for id in relationship_ids {
            if let Some(row) = self.relationships.get_mut(id) {
                row.sync_pending = true;
            }
        }
    }

    fn record_ledger(&mut self, _file_id: Uuid, outcome: &LedgerOutcome) {
        if matches!(outcome, LedgerOutcome::Anchored(_)) {
            self.log.borrow_mut().push(SagaEvent::LedgerAnchored);
        }
    }
}

struct FakeGraph {
    log: SharedLog,
    fail: bool,
    merges: usize,
}

impl GraphWriter for FakeGraph {
    fn merge_case_graph(&mut self, _nodes: &[GraphNode], _edges: &[GraphEdge]) -> Result<(), GraphError> {
        if self.fail {
            return Err(GraphError::Failed("bolt down".to_string()));
        }
        self.merges += 1;
        self.log.borrow_mut().push(SagaEvent::Neo4jMerge);
        Ok(())
    }
}

struct FakeLedger {
    fail: bool,
}

impl LedgerAnchor for FakeLedger {
    fn anchor_extraction(&mut self, _file_id: Uuid, hash: &str) -> Result<String, LedgerError> {
        assert_eq!(hash.len(), 64, "D5 anchors a SHA-256 hex digest");
        if self.fail {
            return Err(LedgerError::Unavailable("gateway down".to_string()));
        }
        Ok("mock-tx-1".to_string())
    }
}

struct StubExtractor {
    result: Result<ExtractionResult, ExtractionFailure>,
    calls: std::cell::Cell<usize>,
    log: SharedLog,
}

impl ExtractionClient for StubExtractor {
    fn extract(
        &self,
        _text: &str,
        _source_ts: Option<time::OffsetDateTime>,
    ) -> Result<ExtractionResult, ExtractionFailure> {
        self.calls.set(self.calls.get() + 1);
        self.log.borrow_mut().push(SagaEvent::ExtractCalled);
        match &self.result {
            Ok(result) => Ok(result.clone()),
            Err(failure) => Err(failure.clone()),
        }
    }
}

fn confirmed_input(disposition: ReviewDisposition) -> IngestInput {
    IngestInput {
        file_id: Uuid::new_v4(),
        case_id: Uuid::new_v4(),
        confirmed_text: "Ravi Kumar called Suresh Yadav on 9822012345.".to_string(),
        disposition,
        source_ts: Some(datetime!(2025-11-02 10:00:00 UTC)),
        provenance: Provenance::Benchmark,
    }
}

fn two_person_result() -> ExtractionResult {
    ExtractionResult {
        entities: vec![
            RawEntity {
                typ: "PERSON".to_string(),
                canonical_name: "Ravi Kumar".to_string(),
                char_start: 0,
                char_end: 10,
            },
            RawEntity {
                typ: "PERSON".to_string(),
                canonical_name: "Suresh Yadav".to_string(),
                char_start: 18,
                char_end: 30,
            },
        ],
        identifiers: vec![RawIdentifier {
            typ: "PHONE".to_string(),
            value: "9822012345".to_string(),
            entity_index: 1,
            char_start: 34,
            char_end: 44,
        }],
        relationships: vec![RawRelationship {
            src_index: 0,
            dst_index: 1,
            typ: "CALLED".to_string(),
            occurred_at: Some(datetime!(2025-11-02 10:00:00 UTC)),
        }],
    }
}

fn harness(
    result: Result<ExtractionResult, ExtractionFailure>,
) -> (StubExtractor, FakeDb, FakeGraph, FakeLedger, SharedLog) {
    let log: SharedLog = Rc::new(RefCell::new(Vec::new()));
    (
        StubExtractor { result, calls: std::cell::Cell::new(0), log: log.clone() },
        FakeDb::new(log.clone()),
        FakeGraph { log: log.clone(), fail: false, merges: 0 },
        FakeLedger { fail: false },
        log,
    )
}

#[test]
fn postgres_commits_before_neo4j_write_is_attempted() {
    let (client, mut db, mut graph, mut ledger, log) = harness(Ok(two_person_result()));
    let input = confirmed_input(ReviewDisposition::Corrected);
    let outcome = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    assert!(matches!(outcome, StepOutcome::Committed { graph_synced: true, .. }));
    assert_eq!(graph.merges, 1);
    assert!(!db.entities.is_empty());
    // D4 ordering, proved on the shared event log: the Postgres commit
    // precedes the first Neo4j write, weights and ledger follow.
    assert_eq!(
        *log.borrow(),
        vec![
            SagaEvent::ExtractCalled,
            SagaEvent::PgCommitted,
            SagaEvent::Neo4jMerge,
            SagaEvent::WeightRecomputed { version: WEIGHT_PARAMS_VERSION },
            SagaEvent::LedgerAnchored,
            SagaEvent::FileStatusSet(FileStatus::Committed),
        ]
    );
}

#[test]
fn neo4j_failure_marks_pending_without_rolling_back_postgres() {
    let (client, mut db, mut graph, mut ledger, _log) = harness(Ok(two_person_result()));
    graph.fail = true;
    let input = confirmed_input(ReviewDisposition::Accepted);
    let outcome = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    let StepOutcome::Committed { entity_ids, relationship_ids, graph_synced, .. } = outcome
    else {
        panic!("neo4j failure must not fail the saga, got {outcome:?}");
    };
    assert!(!graph_synced);
    // Postgres rows stand (D4): still present, flagged for the reconciler.
    assert_eq!(db.entities.len(), 2);
    assert!(entity_ids.iter().all(|id| db.entities[id].sync_pending));
    assert!(relationship_ids.iter().all(|id| db.relationships[id].sync_pending));
}

#[test]
fn provenance_propagates_from_source_file_to_every_row() {
    let (client, mut db, mut graph, mut ledger, _log) = harness(Ok(two_person_result()));
    let input = confirmed_input(ReviewDisposition::Corrected);
    let _ = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    assert!(db.entities.values().all(|row| row.provenance == Provenance::Benchmark));
    assert!(db.relationships.values().all(|row| row.provenance == Provenance::Benchmark));
}

#[test]
fn unknown_weight_version_surfaces_without_rollback() {
    let (client, mut db, mut graph, mut ledger, _log) = harness(Ok(two_person_result()));
    db.known_weight_versions.clear();
    let input = confirmed_input(ReviewDisposition::Corrected);
    let outcome = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    let StepOutcome::Committed { graph_synced: false, .. } = outcome else {
        panic!("weight failure must park rows as pending, got {outcome:?}");
    };
    assert_eq!(db.entities.len(), 2, "committed rows stand");
    assert!(db.weight_calls.iter().all(|(_, v)| *v == WEIGHT_PARAMS_VERSION));
}

#[test]
fn rejected_review_text_is_never_extracted() {
    let (client, mut db, mut graph, mut ledger, _log) = harness(Ok(two_person_result()));
    let input = confirmed_input(ReviewDisposition::Rejected);
    let outcome = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    assert!(matches!(outcome, StepOutcome::NeedsReview { .. }));
    assert_eq!(client.calls.get(), 0, "extractor must not see rejected text");
    assert!(db.entities.is_empty());
}

#[test]
fn quarantine_sets_needs_review_and_stops() {
    let (client, mut db, mut graph, mut ledger, _log) = harness(Err(ExtractionFailure::Quarantined {
        reason: "third failure".to_string(),
    }));
    let file_id = Uuid::new_v4();
    let mut input = confirmed_input(ReviewDisposition::Corrected);
    input.file_id = file_id;
    let outcome = run_steps_7_to_9(&client, &mut db, &mut graph, &mut ledger, input);
    assert!(matches!(outcome, StepOutcome::NeedsReview { .. }));
    assert_eq!(db.statuses.get(&file_id), Some(&FileStatus::NeedsReview));
    assert!(db.entities.is_empty(), "nothing persists on quarantine");
    assert_eq!(graph.merges, 0);
}

#[test]
fn extraction_hash_is_stable_sha256() {
    let first = extraction_hash(&two_person_result());
    let second = extraction_hash(&two_person_result());
    assert_eq!(first, second);
    assert_eq!(first.len(), 64);
}
