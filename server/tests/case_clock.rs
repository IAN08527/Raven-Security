//! M1-T1. Case-clock arithmetic and the declared_start_ts rejection path
//! (D16, CLAUDE.md rule 3). No test here reads the current date or calls
//! `now()`: every timestamp is a literal, matching the rule this task
//! exists to enforce -- a case clock that only ever gets tested against
//! "today" would never catch a bug in the actual offset arithmetic.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::cameras::CameraStore;
use server::case_clock::CaseClock;
use time::macros::datetime;
use tower::ServiceExt;

#[test]
fn frame_250_at_25fps_is_ten_seconds_after_declared_start() {
    let clock = CaseClock::new("cam-01", datetime!(2025-11-02 10:00:00 UTC), 25.0);
    assert_eq!(clock.case_ts(250), datetime!(2025-11-02 10:00:10 UTC));
}

#[test]
fn frame_zero_is_exactly_the_declared_start() {
    let clock = CaseClock::new("cam-01", datetime!(2025-11-02 10:00:00 UTC), 25.0);
    assert_eq!(clock.case_ts(0), datetime!(2025-11-02 10:00:00 UTC));
}

#[tokio::test]
async fn post_cameras_without_declared_start_ts_is_rejected() {
    let app = server::api::cameras::router(CameraStore::default());

    let body = serde_json::json!({
        "code": "CAM-1",
        "label": "Test camera",
        "fps": 10.0
        // declared_start_ts deliberately omitted
    });

    let request = Request::builder()
        .method("POST")
        .uri("/cameras")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds");

    let response = app.oneshot(request).await.expect("router does not fail to respond");
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value = serde_json::from_slice(&bytes).expect("body is valid JSON");
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");
}
