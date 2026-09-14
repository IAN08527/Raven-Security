//! M4-T3/NFR-3. Ego-graph p95 against a seeded 100,000-person-node
//! graph (NFR-3: p95 under 250ms at 100k person nodes).
//!
//! Backend honesty: the traversal measured here is the production
//! `ego_graph` over the in-memory store, not Neo4j over Bolt --
//! Docker is unavailable in this environment, so Neo4j-at-scale numbers
//! are pending infrastructure. The value printed below
//! (`GRAPH_P95_MS=…`) is transcribed verbatim into `docs/RESULTS.md`
//! with the backend stated, per rule 10 (measured, never invented).
//! The test itself fails if p95 reaches 250ms, so the gate holds in CI.

use std::collections::HashMap;
use std::time::Instant;

use server::graph::{EntityType, GraphSnapshot, StoredEdge, StoredNode, ego_graph};
use uuid::Uuid;

const PERSON_NODES: usize = 100_000;
const EDGES_PER_NODE: usize = 4;
const TIMED_RUNS: usize = 50;
const P95_BUDGET_MS: f64 = 250.0;

fn seed_100k() -> (GraphSnapshot, Uuid) {
    // Deterministic pseudo-random graph, no RNG crate needed: node i
    // links to (i*k mod N) for k in 1..=EDGES_PER_NODE, weights cycle
    // 1.0..10.0 so the weight floor actually filters.
    let ids: Vec<Uuid> = (0..PERSON_NODES).map(|_| Uuid::new_v4()).collect();
    let mut nodes = HashMap::with_capacity(PERSON_NODES);
    for (index, id) in ids.iter().enumerate() {
        nodes.insert(
            *id,
            StoredNode { typ: EntityType::Person, label: format!("Person {index}") },
        );
    }
    let mut edges = Vec::with_capacity(PERSON_NODES * EDGES_PER_NODE);
    for (index, id) in ids.iter().enumerate() {
        for k in 1..=EDGES_PER_NODE {
            let other = ids[(index * 7 + k * 13_791) % PERSON_NODES];
            edges.push(StoredEdge {
                id: Uuid::new_v4(),
                src: *id,
                dst: other,
                typ: "CALLED".to_string(),
                weight: ((index + k) % 10) as f64 + 1.0,
            });
        }
    }
    let center = ids[PERSON_NODES / 2];
    (GraphSnapshot::new(nodes, edges), center)
}

#[test]
fn ego_p95_under_250ms_at_100k_person_nodes() {
    let (snapshot, center) = seed_100k();
    assert_eq!(snapshot.nodes.len(), PERSON_NODES);
    let types = EntityType::default_set();

    // Warm up caches and the allocator before timing.
    for _ in 0..5 {
        let _ = ego_graph(&snapshot, center, 2, 0.0, &types);
    }

    let mut samples_ms: Vec<f64> = Vec::with_capacity(TIMED_RUNS);
    // Vary the center per run so the measurement covers the graph,
    // not one cached neighbourhood.
    let ids: Vec<Uuid> = snapshot.nodes.keys().copied().collect();
    for run in 0..TIMED_RUNS {
        let node = ids[(run * 1_009) % ids.len()];
        let start = Instant::now();
        let payload = ego_graph(&snapshot, node, 2, 0.0, &types).expect("query works");
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert!(!payload.nodes.is_empty(), "ego must return its center at least");
        samples_ms.push(elapsed_ms);
    }
    samples_ms.sort_by(|a, b| a.partial_cmp(b).expect("finite timings"));
    let rank = ((0.95 * TIMED_RUNS as f64).ceil() as usize).min(TIMED_RUNS).saturating_sub(1);
    let p95_ms = samples_ms[rank];
    println!(
        "GRAPH_P95_MS={p95_ms:.3} over {TIMED_RUNS} ego hops=2 runs on {PERSON_NODES} person nodes \
         (min {:.3}ms, max {:.3}ms)",
        samples_ms[0],
        samples_ms[TIMED_RUNS - 1]
    );
    assert!(
        p95_ms < P95_BUDGET_MS,
        "NFR-3 violated: ego p95 {p95_ms:.3}ms >= {P95_BUDGET_MS}ms at {PERSON_NODES} nodes"
    );
}
