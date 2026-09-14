//! Movement timeline and routine endpoint tests (API_CONTRACTS.md §2.7).
//!
//! - Timeline points arrive chronological with `clock: "case"`; camera
//!   sourced points resolve `declared_start_ts`, other origins anchor on
//!   the source file instead of an invented value.
//! - Routine clusters report supporting counts; the typical window
//!   appears only at ten or more points; thin clusters are low-data.
//! - Cross-case access is 403; unknown entities are 404.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::cameras::{Camera, CameraStore};
use server::api::entities::{Entity, EntityStore, SyncState};
use server::api::map::{LocationPoint, LocationStore, MapDeps, router};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    entities: EntityStore,
    locations: LocationStore,
    cameras: CameraStore,
    assignments: AssignmentStore,
    _gateway: support::StubGateway,
}

fn fixed_ts() -> OffsetDateTime {
    OffsetDateTime::parse("2025-11-02T14:00:00Z", &Rfc3339).expect("fixed timestamp parses")
}

impl Harness {
    async fn start() -> Self {
        let entities = EntityStore::default();
        let locations = LocationStore::default();
        let cameras = CameraStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = router(MapDeps {
            auth,
            ledger: gateway.client(),
            audit,
            profiles,
            assignments: assignments.clone(),
            entities: entities.clone(),
            locations: locations.clone(),
            cameras: cameras.clone(),
        });
        Self { app, entities, locations, cameras, assignments, _gateway: gateway }
    }

    fn seed_entity(&self, case_id: Uuid) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: "PERSON".to_string(),
            canonical_name: "Ravi Kumar".to_string(),
            aliases: Vec::new(),
            identifiers: Vec::new(),
            relationships: Vec::new(),
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }

    fn seed_camera(&self) -> Uuid {
        let id = Uuid::new_v4();
        self.cameras.insert(Camera {
            id,
            code: "cam_01".to_string(),
            label: "Gate".to_string(),
            declared_start_ts: fixed_ts(),
            fps: 10.0,
        });
        id
    }

    #[allow(clippy::too_many_arguments)]
    fn seed_point(
        &self,
        entity_id: Uuid,
        at: OffsetDateTime,
        lat: f64,
        lon: f64,
        origin: &str,
        camera_id: Option<Uuid>,
    ) {
        self.locations.insert(LocationPoint {
            id: Uuid::new_v4(),
            entity_id,
            ts: at,
            lat,
            lon,
            origin: origin.to_string(),
            accuracy_m: Some(50),
            provenance: "collected".to_string(),
            source_file_id: if camera_id.is_none() { Some(Uuid::new_v4()) } else { None },
            camera_id,
        });
    }
}

fn get_request(uri: String, token: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
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
async fn timeline_is_chronological_with_anchors_labelled() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let camera_id = harness.seed_camera();
    let base = fixed_ts();
    harness.seed_point(entity_id, base, 19.0760, 72.8777, "cdr", None);
    harness.seed_point(entity_id, base + Duration::hours(3), 19.0761, 72.8778, "cctv", Some(camera_id));
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}/timeline"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["origin"], "cdr");
    assert_eq!(results[1]["origin"], "cctv");
    for point in results {
        assert_eq!(point["clock"], "case");
    }
    assert_eq!(results[0]["declared_start_ts"], Value::Null);
    assert!(results[0]["source_file_id"].is_string());
    assert_eq!(results[1]["declared_start_ts"], "2025-11-02T14:00:00Z");
    assert_eq!(results[1]["camera_id"], camera_id.to_string());
}

#[tokio::test]
async fn timeline_access_rules_match_entities() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    harness.seed_point(entity_id, fixed_ts(), 19.0760, 72.8777, "fir", None);
    let officer = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/entities/{entity_id}/timeline"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{}/timeline", Uuid::new_v4()), &token))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn routine_reports_counts_window_floor_and_low_data() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let base = fixed_ts();
    for index in 0..12 {
        harness.seed_point(
            entity_id,
            base + Duration::hours(index),
            19.0760,
            72.8777,
            "cdr",
            None,
        );
    }
    for index in 0..3 {
        harness.seed_point(
            entity_id,
            base + Duration::hours(index),
            18.5204,
            73.8567,
            "address",
            None,
        );
    }
    let analyst = Uuid::new_v4();
    harness.assignments.assign(case_id, analyst, AppRole::Analyst);
    let token = support::mint_token(&analyst, "analyst", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}/routine"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["total_points"], 15);
    let clusters = parsed["clusters"].as_array().expect("clusters array");
    assert_eq!(clusters.len(), 2);
    // Sorted by visit count, descending.
    assert_eq!(clusters[0]["visit_count"], 12);
    assert_eq!(clusters[0]["confidence_pct"], 80);
    assert_eq!(clusters[0]["low_data"], false);
    assert!(clusters[0]["typical_window"].is_string(), "window shown at a dozen visits");
    assert_eq!(clusters[1]["visit_count"], 3);
    assert_eq!(clusters[1]["confidence_pct"], 20);
    assert_eq!(clusters[1]["low_data"], true);
    assert!(clusters[1]["typical_window"].is_null(), "no window below the floor");
}

#[tokio::test]
async fn routine_without_points_is_empty_not_an_error() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}/routine"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["total_points"], 0);
    assert!(parsed["clusters"].as_array().expect("array").is_empty());
}
