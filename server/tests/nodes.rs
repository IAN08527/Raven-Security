//! M1-T3. Engine node registration: upsert-by-name and degraded status.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::nodes::NodeStore;
use tower::ServiceExt;

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    serde_json::from_slice(&bytes).expect("body is valid JSON")
}

fn register_request(name: &str, budget_dps: f64, status: &str) -> Request<Body> {
    let body = serde_json::json!({
        "name": name,
        "address": "https://engine-1:8756",
        "budget_dps": budget_dps,
        "vram_ceiling": 1_000_000_000i64,
        "max_batch": 8,
        "gpu_name": "mock-gpu",
        "status": status,
    });
    Request::builder()
        .method("POST")
        .uri("/nodes")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds")
}

#[tokio::test]
async fn registering_a_degraded_node_records_its_status() {
    let app = server::api::nodes::router(NodeStore::default());
    let response = app
        .oneshot(register_request("engine-1", 5.0, "degraded"))
        .await
        .expect("router responds");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = body_json(response).await;
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["budget_dps"], 5.0);
}

#[tokio::test]
async fn reregistering_the_same_node_updates_rather_than_duplicates() {
    let store = NodeStore::default();
    let app = server::api::nodes::router(store);

    let first = app.clone().oneshot(register_request("engine-1", 5.0, "degraded")).await.unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);

    let second =
        app.clone().oneshot(register_request("engine-1", 120.0, "ready")).await.unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = body_json(second).await;
    assert_eq!(second_body["status"], "ready");
    assert_eq!(second_body["budget_dps"], 120.0);

    let list_request = Request::builder()
        .method("GET")
        .uri("/nodes")
        .body(Body::empty())
        .expect("request builds");
    let list_response = app.oneshot(list_request).await.expect("router responds");
    let nodes = body_json(list_response).await;
    let nodes_array = nodes.as_array().expect("nodes is a JSON array");
    assert_eq!(nodes_array.len(), 1, "re-registering must upsert, not duplicate");
    assert_eq!(nodes_array[0]["status"], "ready");
}
