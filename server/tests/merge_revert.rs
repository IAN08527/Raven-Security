//! Merge revert endpoint tests (FR-3.3, D4, D21).
//!
//! - Only a confirmed, not-yet-reverted merge can be reverted: pending,
//!   rejected and already-reverted merges answer 409, never half-unwound.
//! - Revert restores both participants from the `reversible_snapshot`
//!   captured at confirm time (aliases, identifiers, relationships).
//! - Both affected entities go back to `sync_state='pending'` so the
//!   reconciler re-syncs the derived Neo4j projection (D4).
//! - The merge row returns to `proposed` with `reverted_at` set: reverted
//!   in history, never vanished.
//! - Every revert writes one `merge.revert` audit row and anchors.
//! - Revert requires the io role: the auditor is read-only, the admin has
//!   no case-content access.

#[path = "support/mod.rs"]
mod support;

use std::sync::Mutex;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::entities::{
    ConsolidateGraph, EntitiesDeps, Entity, EntityStore, MergeProposal, MergeStatus, MergeStore,
    NotesStore, SyncState,
};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::ProfilesStore;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    entities: EntityStore,
    merges: MergeStore,
    audit: AuditStore,
    profiles: ProfilesStore,
    next_id: Mutex<i64>,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let entities = EntityStore::default();
        let merges = MergeStore::default();
        let graph = ConsolidateGraph::default();
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::entities::router(
            entities.clone(),
            merges.clone(),
            EntitiesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles: profiles.clone(),
                assignments: AssignmentStore::default(),
                notes: NotesStore::default(),
                graph,
            },
        );
        Self { app, entities, merges, audit, profiles, next_id: Mutex::new(1), _gateway: gateway }
    }

    fn io_token(&self, user: &Uuid) -> String {
        support::mint_token(user, "io", 3600)
    }

    fn seed_entity(
        &self,
        case_id: Uuid,
        name: &str,
        aliases: Vec<String>,
        identifiers: Vec<String>,
        relationships: Vec<Uuid>,
    ) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: "PERSON".to_string(),
            canonical_name: name.to_string(),
            aliases,
            identifiers,
            relationships,
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }

    fn seed_merge(&self, case_id: Uuid, surviving_id: Uuid, merged_id: Uuid) -> i64 {
        let mut next = self.next_id.lock().unwrap_or_else(|p| p.into_inner());
        let id = *next;
        *next += 1;
        self.merges.insert(MergeProposal {
            id,
            case_id,
            surviving_id,
            merged_id,
            reason: "shared identifier plus normalised name".to_string(),
            status: MergeStatus::Proposed,
            sync_state: SyncState::Synced,
            decided_by: None,
            ledger_tx_id: None,
            reversible_snapshot: None,
            reverted_at: None,
        });
        id
    }

    /// Two entities with disjoint attributes plus a merge proposal between
    /// them, so absorption at confirm time and restoration at revert time
    /// are both observable.
    fn seed_pair(&self, case_id: Uuid) -> (Uuid, Uuid, Uuid, i64) {
        let third = self.seed_entity(case_id, "Third Witness", vec![], vec![], vec![]);
        let surviving = self.seed_entity(
            case_id,
            "Ravi Kumar",
            vec!["Ravi".to_string()],
            vec!["id-ravi".to_string()],
            vec![],
        );
        let merged = self.seed_entity(
            case_id,
            "R Kumar",
            vec!["RK".to_string()],
            vec!["id-rk".to_string()],
            vec![third],
        );
        let merge_id = self.seed_merge(case_id, surviving, merged);
        (surviving, merged, third, merge_id)
    }

    async fn decide(&self, merge_id: i64, token: &str, decision: &str) -> (StatusCode, Value) {
        let response = self
            .app
            .clone()
            .oneshot(decide_request(merge_id, token, decision))
            .await
            .expect("router responds");
        body_json(response).await
    }

    async fn revert(&self, merge_id: i64, token: &str) -> (StatusCode, Value) {
        let response = self
            .app
            .clone()
            .oneshot(revert_request(merge_id, token))
            .await
            .expect("router responds");
        body_json(response).await
    }
}

fn decide_request(id: i64, token: &str, decision: &str) -> Request<Body> {
    let body = serde_json::json!({"decision": decision, "note": "checked against source spans"});
    Request::builder()
        .method("POST")
        .uri(format!("/merges/{id}/decide"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .expect("request builds")
}

fn revert_request(id: i64, token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/merges/{id}/revert"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn confirmed_merge_can_be_reverted() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (_, _, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    harness.profiles.set_ledger_id(reverter, "officer-ledger-1");
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);

    let (status, parsed) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["merge_id"], merge_id);
    assert!(parsed["reverted_at"].as_str().is_some(), "revert answers its timestamp");
    assert!(parsed["ledger_tx_id"].as_str().is_some(), "revert anchors like every decision");
}

#[tokio::test]
async fn aliases_restored_after_revert() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (surviving, merged, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    // Confirm absorbs: the survivor carries the merged name and alias.
    let absorbed = harness.entities.get(&surviving).expect("survivor remains");
    assert!(absorbed.aliases.contains(&"R Kumar".to_string()));
    assert!(absorbed.aliases.contains(&"RK".to_string()));

    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);
    let restored = harness.entities.get(&surviving).expect("survivor remains");
    assert_eq!(restored.aliases, vec!["Ravi".to_string()]);
    let restored_merged = harness.entities.get(&merged).expect("merged row remains");
    assert_eq!(restored_merged.aliases, vec!["RK".to_string()]);
}

#[tokio::test]
async fn identifiers_restored_after_revert() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (surviving, merged, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    let absorbed = harness.entities.get(&surviving).expect("survivor remains");
    assert!(absorbed.identifiers.contains(&"id-rk".to_string()));

    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);
    let restored = harness.entities.get(&surviving).expect("survivor remains");
    assert_eq!(restored.identifiers, vec!["id-ravi".to_string()]);
    let restored_merged = harness.entities.get(&merged).expect("merged row remains");
    assert_eq!(restored_merged.identifiers, vec!["id-rk".to_string()]);
}

#[tokio::test]
async fn relationships_restored_after_revert() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (surviving, merged, third, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    let absorbed = harness.entities.get(&surviving).expect("survivor remains");
    assert!(absorbed.relationships.contains(&third));

    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);
    let restored = harness.entities.get(&surviving).expect("survivor remains");
    assert!(restored.relationships.is_empty());
    let restored_merged = harness.entities.get(&merged).expect("merged row remains");
    assert_eq!(restored_merged.relationships, vec![third]);
}

#[tokio::test]
async fn pending_merge_cannot_be_reverted() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (_, _, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, parsed) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");

    // Nothing unwound, nothing audited.
    assert!(harness.audit.is_empty());
}

#[tokio::test]
async fn already_reverted_merge_cannot_be_reverted() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (_, _, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);

    let (status, parsed) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");
}

#[tokio::test]
async fn revert_writes_audit_row() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (_, _, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);

    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 2);
    let reverts: Vec<_> = rows.iter().filter(|row| row.action == "merge.revert").collect();
    assert_eq!(reverts.len(), 1);
    assert_eq!(reverts[0].object_type, "entity_merge");
    assert_eq!(reverts[0].object_id, merge_id.to_string());
    assert_eq!(reverts[0].user_id, reverter);
    assert_eq!(reverts[0].user_role, server::auth::AppRole::Io);
}

#[tokio::test]
async fn affected_entities_have_sync_state_pending() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (surviving, merged, _, merge_id) = harness.seed_pair(case_id);
    let reverter = Uuid::new_v4();
    let token = harness.io_token(&reverter);

    let (status, _) = harness.decide(merge_id, &token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::OK);

    // D4: Postgres is the source of truth; both rows marked pending so
    // the reconciler re-syncs the derived Neo4j projection.
    let survivor = harness.entities.get(&surviving).expect("survivor remains");
    assert_eq!(survivor.sync_state, SyncState::Pending);
    let other = harness.entities.get(&merged).expect("merged row remains");
    assert_eq!(other.sync_state, SyncState::Pending);
}

#[tokio::test]
async fn auditor_role_cannot_revert() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let (_, _, _, merge_id) = harness.seed_pair(case_id);
    let decider = Uuid::new_v4();
    let io_token = harness.io_token(&decider);
    let (status, _) = harness.decide(merge_id, &io_token, "confirmed").await;
    assert_eq!(status, StatusCode::OK);

    let auditor = Uuid::new_v4();
    let token = support::mint_token(&auditor, "auditor", 3600);
    let (status, parsed) = harness.revert(merge_id, &token).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");
}
