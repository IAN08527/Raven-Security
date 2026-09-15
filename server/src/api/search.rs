//! Global search endpoint (API_CONTRACTS.md §2.12, design §13).
//!
//! One call across entities (name plus aliases), cases (code plus
//! title), source files (filename) and identifier values, grouped by
//! kind. Matching here is case-insensitive substring — the in-memory
//! equivalent of the production `ILIKE '%q%'` queries, which ride the
//! pg_trgm GIN indexes from migration `20260915000000` (a leading
//! wildcard cannot use a btree, hence GIN). Real persistence through
//! the content tables with per-case RLS is the same documented
//! follow-up as every other store in this service.
//!
//! Access rule: results come only from the caller's assigned cases
//! (D21). Without `case_id` the search spans every assigned case; with
//! it, the case must be assigned or the call is `CASE_ACCESS_DENIED` —
//! never an empty result set that leaks which cases exist.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::api::entities::EntityStore;
use crate::api::files::FileStore;
use crate::ledger::LedgerClient;

/// One case row as held by this service, mirroring the baseline
/// `cases` columns the search contract exposes. Populated by the case
/// lifecycle (and by tests); production reads the `cases` table through
/// RLS instead.
#[derive(Debug, Clone, Serialize, TS)]
pub struct CaseRecord {
    pub id: Uuid,
    pub case_code: String,
    pub title: String,
}

#[derive(Debug, Clone, Default)]
pub struct CaseStore(Arc<Mutex<Vec<CaseRecord>>>);

impl CaseStore {
    fn lock(&self) -> MutexGuard<'_, Vec<CaseRecord>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, case: CaseRecord) {
        self.lock().push(case);
    }

    pub fn visible(&self, cases: &HashSet<Uuid>) -> Vec<CaseRecord> {
        self.lock().iter().filter(|case| cases.contains(&case.id)).cloned().collect()
    }
}

const GROUP_CAP: usize = 10;
const TOTAL_CAP: usize = 40;

#[derive(Debug, Serialize, TS)]
pub struct EntityHit {
    pub id: Uuid,
    pub case_id: Uuid,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub canonical_name: String,
    pub provenance: String,
}

#[derive(Debug, Serialize, TS)]
pub struct CaseHit {
    pub id: Uuid,
    pub case_code: String,
    pub title: String,
}

#[derive(Debug, Serialize, TS)]
pub struct FileHit {
    pub id: Uuid,
    pub case_id: Uuid,
    pub name: String,
    pub provenance: String,
}

#[derive(Debug, Serialize, TS)]
pub struct IdentifierHit {
    pub entity_id: Uuid,
    pub case_id: Uuid,
    pub value: String,
    pub provenance: String,
}

#[derive(Debug, Serialize, TS)]
pub struct SearchResponse {
    pub entities: Vec<EntityHit>,
    pub cases: Vec<CaseHit>,
    pub files: Vec<FileHit>,
    pub identifiers: Vec<IdentifierHit>,
}

impl SearchResponse {
    fn empty() -> Self {
        Self { entities: Vec::new(), cases: Vec::new(), files: Vec::new(), identifiers: Vec::new() }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub types: Option<String>,
    pub case_id: Option<Uuid>,
    pub limit: Option<usize>,
}

#[derive(Clone)]
pub struct SearchDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub assignments: AssignmentStore,
    pub entities: EntityStore,
    pub cases: CaseStore,
    pub files: FileStore,
}

#[derive(Clone)]
struct SearchState {
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    assignments: AssignmentStore,
    entities: EntityStore,
    cases: CaseStore,
    files: FileStore,
}

pub fn router(deps: SearchDeps) -> Router {
    let state = SearchState {
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        assignments: deps.assignments,
        entities: deps.entities,
        cases: deps.cases,
        files: deps.files,
    };
    Router::new().route("/search", get(global_search)).with_state(state)
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

async fn authorize(
    headers: &HeaderMap,
    state: &SearchState,
) -> Result<AuthContext, Box<Response>> {
    authenticate_request(headers, &state.auth, &[AppRole::Io, AppRole::Analyst, AppRole::Auditor])
        .await
}

/// GET /search (API_CONTRACTS.md §2.12).
async fn global_search(
    State(state): State<SearchState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Response {
    let context = match authorize(&headers, &state).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let wanted: HashSet<Uuid> = match query.case_id {
        Some(case_id) => {
            if !state.assignments.is_assigned(&case_id, &context.user_id) {
                return error(
                    "CASE_ACCESS_DENIED",
                    StatusCode::FORBIDDEN,
                    format!("no assignment for this user on case {case_id}"),
                );
            }
            HashSet::from([case_id])
        }
        None => state.assignments.cases_for_user(&context.user_id).into_iter().collect(),
    };
    let groups = match query.types.as_deref().map(str::to_lowercase).as_deref() {
        None | Some("all") => vec!["entities", "cases", "files", "identifiers"],
        Some("entities") => vec!["entities"],
        Some("cases") => vec!["cases"],
        Some("files") => vec!["files"],
        Some("identifiers") => vec!["identifiers"],
        Some(other) => {
            return error(
                "VALIDATION_FAILED",
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("unknown search type: {other}"),
            )
        }
    };
    let needle = query.q.unwrap_or_default().to_lowercase();
    // Empty query is an empty result, not an error: the palette fires on
    // every keystroke including the cleared box.
    if needle.is_empty() {
        return (StatusCode::OK, Json(SearchResponse::empty())).into_response();
    }
    let contains = |haystack: &str| haystack.to_lowercase().contains(needle.as_str());

    let mut response = SearchResponse::empty();
    if groups.contains(&"entities") {
        response.entities = state
            .entities
            .all()
            .into_iter()
            .filter(|entity| wanted.contains(&entity.case_id))
            .filter(|entity| {
                contains(&entity.canonical_name)
                    || entity.aliases.iter().any(|alias| contains(alias))
            })
            .take(GROUP_CAP)
            .map(|entity| EntityHit {
                id: entity.id,
                case_id: entity.case_id,
                entity_type: entity.entity_type,
                canonical_name: entity.canonical_name,
                provenance: entity.provenance,
            })
            .collect();
    }
    if groups.contains(&"cases") {
        response.cases = state
            .cases
            .visible(&wanted)
            .into_iter()
            .filter(|case| contains(&case.case_code) || contains(&case.title))
            .take(GROUP_CAP)
            .map(|case| CaseHit { id: case.id, case_code: case.case_code, title: case.title })
            .collect();
    }
    if groups.contains(&"files") {
        let mut files = Vec::new();
        for case_id in &wanted {
            files.extend(state.files.files_for_case(case_id));
        }
        response.files = files
            .into_iter()
            .filter(|file| contains(&file.name))
            .take(GROUP_CAP)
            .map(|file| FileHit {
                id: file.id,
                case_id: file.case_id,
                name: file.name,
                provenance: file.provenance,
            })
            .collect();
    }
    if groups.contains(&"identifiers") {
        response.identifiers = state
            .entities
            .all()
            .into_iter()
            .filter(|entity| wanted.contains(&entity.case_id))
            .flat_map(|entity| {
                let case_id = entity.case_id;
                let provenance = entity.provenance.clone();
                entity.identifiers.into_iter().map(move |value| IdentifierHit {
                    entity_id: entity.id,
                    case_id,
                    value,
                    provenance: provenance.clone(),
                })
            })
            .filter(|hit| contains(&hit.value))
            .take(GROUP_CAP)
            .collect();
    }
    // Total cap: groups fill in contract order, truncated to `limit`.
    let limit = query.limit.unwrap_or(TOTAL_CAP).clamp(1, TOTAL_CAP);
    let mut remaining = limit;
    let take = |len: usize, remaining: &mut usize| {
        let n = (*remaining).min(len);
        *remaining -= n;
        n
    };
    let n = take(response.entities.len(), &mut remaining);
    response.entities.truncate(n);
    let n = take(response.cases.len(), &mut remaining);
    response.cases.truncate(n);
    let n = take(response.files.len(), &mut remaining);
    response.files.truncate(n);
    let n = take(response.identifiers.len(), &mut remaining);
    response.identifiers.truncate(n);
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: query.case_id.unwrap_or_else(Uuid::nil),
            user_id: context.user_id,
            user_role: context.role,
            action: "search.query".to_string(),
            object_type: "search".to_string(),
            object_id: needle.clone(),
            payload_hash: needle,
        },
    )
    .await;
    (StatusCode::OK, Json(response)).into_response()
}
