//! M2-T3 (server side). Topology prior tests: inside-window maximum,
//! no-edge zero, outside-window interpolation. All timestamps are fixed
//! literals -- no test calls `now()` or uses the current date (D16).

use server::reid::topology::{CameraEdge, compute_prior};
use time::macros::datetime;
use uuid::Uuid;

fn edge(from: Uuid, to: Uuid) -> CameraEdge {
    CameraEdge { from_camera: from, to_camera: to, mean_travel_s: 600.0, stddev_s: 60.0 }
}

#[test]
fn inside_window_gets_minus_0_15() {
    let last = Uuid::new_v4();
    let cam = Uuid::new_v4();
    let last_ts = datetime!(2025-11-02 14:00:00 UTC);
    let candidate_ts = datetime!(2025-11-02 14:10:00 UTC);
    let prior = compute_prior(&[edge(last, cam)], last, last_ts, cam, candidate_ts);
    assert_eq!(prior.prior_adjustment, -0.15);
    assert_eq!(prior.expected_from, Some(last));
    let window = prior.expected_window.expect("window present");
    assert_eq!(window.start, datetime!(2025-11-02 14:08:00 UTC));
    assert_eq!(window.end, datetime!(2025-11-02 14:12:00 UTC));
}

#[test]
fn no_edge_gets_zero() {
    let last = Uuid::new_v4();
    let cam = Uuid::new_v4();
    let other = Uuid::new_v4();
    let last_ts = datetime!(2025-11-02 14:00:00 UTC);
    let prior = compute_prior(
        &[edge(last, other)],
        last,
        last_ts,
        cam,
        datetime!(2025-11-02 14:10:00 UTC),
    );
    assert_eq!(prior.prior_adjustment, 0.0);
    assert_eq!(prior.expected_from, None);
    assert!(prior.expected_window.is_none());
}

#[test]
fn outside_window_on_valid_edge_interpolates() {
    let last = Uuid::new_v4();
    let cam = Uuid::new_v4();
    let last_ts = datetime!(2025-11-02 14:00:00 UTC);
    let prior = compute_prior(
        &[edge(last, cam)],
        last,
        last_ts,
        cam,
        datetime!(2025-11-02 14:20:00 UTC),
    );
    assert!(
        prior.prior_adjustment > -0.15 && prior.prior_adjustment < 0.0,
        "got {}",
        prior.prior_adjustment
    );
}
