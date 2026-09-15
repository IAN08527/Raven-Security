//! Movement timeline and routine endpoints (API_CONTRACTS.md §2.7, FR-6).
//!
//! The timeline plots `location_history` rows: case-clock timestamps
//! with origin (cdr, fir, address, cctv). Every point carries an
//! explicit source anchor so the UI never mixes clocks (D16): camera
//! sourced points resolve the source camera's `declared_start_ts`
//! through the `camera_id` link (migration `20260915000001`); every
//! other origin anchors on its source file instead. There is no third
//! option — an anchor is never invented.
//!
//! Routine identification is deterministic counting, not a model: points
//! fall into ~1.1km grid cells, and a cluster reports its supporting
//! point count alongside a `confidence_pct` that is exactly the share
//! of observed points in that cell — a stated proportion, never a
//! prediction (PRD §5 excludes forecasting). The "typically present"
//! window appears only at ten or more supporting points (FR-6.3), and
//! area labels are grid coordinates, never invented place names
//! (rule 10). Real persistence through `location_history` with per-case
//! RLS is the same documented follow-up as every other store here.

use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::api::cameras::CameraStore;
use crate::api::entities::EntityStore;
use crate::api::timeline::Clock;
use crate::ledger::LedgerClient;

/// One location row as held by this service, mirroring the baseline
/// `location_history` columns (plus `camera_id` from migration
/// `20260915000001`). `ts` is always case-clock (D16).
#[derive(Debug, Clone)]
pub struct LocationPoint {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub ts: OffsetDateTime,
    pub lat: f64,
    pub lon: f64,
    pub origin: String,
    pub accuracy_m: Option<i32>,
    pub provenance: String,
    pub source_file_id: Option<Uuid>,
    pub camera_id: Option<Uuid>,
}

#[derive(Debug, Clone, Default)]
pub struct LocationStore(Arc<Mutex<Vec<LocationPoint>>>);

impl LocationStore {
    fn lock(&self) -> MutexGuard<'_, Vec<LocationPoint>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, point: LocationPoint) {
        self.lock().push(point);
    }

    pub fn points_for(&self, entity_id: &Uuid) -> Vec<LocationPoint> {
        let mut points: Vec<LocationPoint> =
            self.lock().iter().filter(|point| &point.entity_id == entity_id).cloned().collect();
        points.sort_by_key(|point| point.ts);
        points
    }
}

/// Map responses are bounded like every other listing: plots with
/// thousands of points stay interactive, and the cap is stated.
const DEFAULT_POINT_LIMIT: usize = 500;
const MAX_POINT_LIMIT: usize = 2000;

#[derive(Debug, Serialize, TS)]
pub struct MovementPoint {
    pub ts: String,
    // Shared Clock enum (timeline.rs): movement points are always
    // case-clock today, so this serializes exactly as before ("case")
    // while giving the generated type the "case" | "system" union.
    pub clock: Clock,
    pub lat: f64,
    pub lon: f64,
    pub origin: String,
    pub accuracy_m: Option<i32>,
    pub provenance: String,
    pub source_file_id: Option<Uuid>,
    pub camera_id: Option<Uuid>,
    pub declared_start_ts: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct MovementTimelineResponse {
    pub results: Vec<MovementPoint>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MovementQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct RoutineCluster {
    pub area: String,
    pub lat: f64,
    pub lon: f64,
    pub visit_count: usize,
    pub confidence_pct: u8,
    pub typical_window: Option<String>,
    pub low_data: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct RoutineResponse {
    pub clusters: Vec<RoutineCluster>,
    pub total_points: usize,
}

#[derive(Clone)]
pub struct MapDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub assignments: AssignmentStore,
    pub entities: EntityStore,
    pub locations: LocationStore,
    pub cameras: CameraStore,
}

#[derive(Clone)]
struct MapState {
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    assignments: AssignmentStore,
    entities: EntityStore,
    locations: LocationStore,
    cameras: CameraStore,
}

pub fn router(deps: MapDeps) -> Router {
    let state = MapState {
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        assignments: deps.assignments,
        entities: deps.entities,
        locations: deps.locations,
        cameras: deps.cameras,
    };
    Router::new()
        .route("/entities/:id/timeline", get(movement_timeline))
        .route("/entities/:id/routine", get(movement_routine))
        .with_state(state)
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorBody {
    code: &'static str,
    message: String,
    detail: serde_json::Value,
    retryable: bool,
    trace_id: String,
}

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorBody {
                code,
                message: message.into(),
                detail: serde_json::json!({}),
                retryable: false,
                trace_id: ulid::Ulid::new().to_string(),
            },
        }),
    )
        .into_response()
}

async fn authorize_entity(
    headers: &HeaderMap,
    state: &MapState,
    entity_id: &Uuid,
) -> Result<(AuthContext, Uuid), Box<Response>> {
    let Some(entity) = state.entities.get(entity_id) else {
        return Err(Box::new(
            error("NOT_FOUND", StatusCode::NOT_FOUND, format!("entity {entity_id} not found"))
                .into_response(),
        ));
    };
    let context = authenticate_request(
        headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor],
    )
    .await?;
    if !state.assignments.is_assigned(&entity.case_id, &context.user_id) {
        return Err(Box::new(
            error(
                "CASE_ACCESS_DENIED",
                StatusCode::FORBIDDEN,
                format!("no assignment for this user on case {}", entity.case_id),
            )
            .into_response(),
        ));
    }
    Ok((context, entity.case_id))
}

fn parse_time(value: &Option<String>) -> Result<Option<OffsetDateTime>, Box<Response>> {
    match value {
        None => Ok(None),
        Some(raw) => OffsetDateTime::parse(raw, &Rfc3339).map(Some).map_err(|_| {
            Box::new(error("VALIDATION_FAILED", StatusCode::BAD_REQUEST, "from/to must be RFC 3339"))
        }),
    }
}

fn parse_cursor(cursor: &Option<String>) -> Result<usize, Box<Response>> {
    match cursor {
        None => Ok(0),
        Some(raw) => raw.parse().map_err(|_| {
            Box::new(error(
                "VALIDATION_FAILED",
                StatusCode::UNPROCESSABLE_ENTITY,
                "cursor is not a valid list offset",
            ))
        }),
    }
}

async fn anchor_read(
    state: &MapState,
    context: &AuthContext,
    case_id: Uuid,
    entity_id: &Uuid,
    action: &str,
) {
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: context.user_id,
            user_role: context.role,
            action: action.to_string(),
            object_type: "entity".to_string(),
            object_id: entity_id.to_string(),
            payload_hash: entity_id.to_string(),
        },
    )
    .await;
}

/// GET /entities/{id}/timeline (API_CONTRACTS.md §2.7): chronological
/// location points with case-clock timestamps and per-point anchors.
async fn movement_timeline(
    State(state): State<MapState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(query): Query<MovementQuery>,
) -> Response {
    let (context, case_id) = match authorize_entity(&headers, &state, &id).await {
        Ok(authorised) => authorised,
        Err(boxed) => return *boxed,
    };
    let from = match parse_time(&query.from) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let to = match parse_time(&query.to) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let limit = query.limit.unwrap_or(DEFAULT_POINT_LIMIT).clamp(1, MAX_POINT_LIMIT);
    let offset = match parse_cursor(&query.cursor) {
        Ok(offset) => offset,
        Err(boxed) => return *boxed,
    };
    let points: Vec<MovementPoint> = state
        .locations
        .points_for(&id)
        .into_iter()
        .filter(|point| from.is_none_or(|from| point.ts >= from))
        .filter(|point| to.is_none_or(|to| point.ts <= to))
        .map(|point| {
            let declared_start_ts = point.camera_id.as_ref().and_then(|camera_id| {
                state.cameras.get(camera_id).map(|camera| {
                    camera.declared_start_ts.format(&Rfc3339).unwrap_or_default()
                })
            });
            MovementPoint {
                ts: point.ts.format(&Rfc3339).unwrap_or_default(),
                clock: Clock::Case,
                lat: point.lat,
                lon: point.lon,
                origin: point.origin,
                accuracy_m: point.accuracy_m,
                provenance: point.provenance,
                source_file_id: point.source_file_id,
                camera_id: point.camera_id,
                declared_start_ts,
            }
        })
        .collect();
    let page: Vec<MovementPoint> =
        points.into_iter().skip(offset).take(limit + 1).collect();
    let next_cursor =
        if page.len() > limit { Some((offset + limit).to_string()) } else { None };
    let page = page.into_iter().take(limit).collect();
    anchor_read(&state, &context, case_id, &id, "movement.timeline").await;
    (StatusCode::OK, Json(MovementTimelineResponse { results: page, next_cursor })).into_response()
}

const WEEKDAY_SHORT: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// Minimum supporting points before a "typically present" window is
/// shown (FR-6.3): a pattern from fewer points must be visibly thin.
const ROUTINE_WINDOW_FLOOR: usize = 10;

#[derive(Default)]
struct CellTally {
    count: usize,
    weekdays: [u32; 7],
    hour_blocks: [u32; 12],
}

/// GET /entities/{id}/routine (API_CONTRACTS.md §2.7, FR-6.3): grid
/// clusters with supporting counts. Deterministic throughout: ties in
/// modal weekday or hour block resolve to the later slot, which is
/// arbitrary but stable — and stated as such here rather than dressed
/// as significance.
async fn movement_routine(
    State(state): State<MapState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let (context, case_id) = match authorize_entity(&headers, &state, &id).await {
        Ok(authorised) => authorised,
        Err(boxed) => return *boxed,
    };
    let points = state.locations.points_for(&id);
    let total_points = points.len();
    let mut cells: HashMap<(i64, i64), CellTally> = HashMap::new();
    for point in &points {
        let key = ((point.lat * 100.0).round() as i64, (point.lon * 100.0).round() as i64);
        let tally = cells.entry(key).or_default();
        tally.count += 1;
        tally.weekdays[point.ts.weekday().number_days_from_monday() as usize] += 1;
        tally.hour_blocks[(point.ts.hour() as usize / 2).min(11)] += 1;
    }
    let mut clusters: Vec<RoutineCluster> = cells
        .into_iter()
        .map(|((lat_key, lon_key), tally)| {
            let lat = lat_key as f64 / 100.0;
            let lon = lon_key as f64 / 100.0;
            // Share of observed points in this cell: descriptive, not
            // predictive (PRD §5). Tops out at 100 by construction.
            let confidence_pct =
                (100.0 * tally.count as f64 / total_points.max(1) as f64).round() as u8;
            let typical_window = if tally.count >= ROUTINE_WINDOW_FLOOR {
                let days: Vec<usize> = (0..7).filter(|day| tally.weekdays[*day] > 0).collect();
                let day_label = if days.windows(2).all(|pair| pair[1] == pair[0] + 1) && days.len() > 1 {
                    format!("{}–{}", WEEKDAY_SHORT[days[0]], WEEKDAY_SHORT[days[days.len() - 1]])
                } else {
                    days.iter().map(|day| WEEKDAY_SHORT[*day]).collect::<Vec<_>>().join(", ")
                };
                let block = tally
                    .hour_blocks
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, count)| *count)
                    .map(|(block, _)| block)
                    .unwrap_or(0);
                let start_hour = block * 2;
                Some(format!("{day_label} {start_hour:02}:00–{:02}:00", start_hour + 2))
            } else {
                None
            };
            RoutineCluster {
                area: format!("{lat:.2}°, {lon:.2}°"),
                lat,
                lon,
                visit_count: tally.count,
                confidence_pct,
                typical_window,
                low_data: tally.count < 5,
            }
        })
        .collect();
    clusters.sort_by_key(|cluster| Reverse(cluster.visit_count));
    anchor_read(&state, &context, case_id, &id, "movement.routine").await;
    (StatusCode::OK, Json(RoutineResponse { clusters, total_points })).into_response()
}
