//! Real GoTrue JWT verification (M5-T1, D21).
//!
//! The presence-check stubs in the M1/M2/M3 endpoint modules are replaced
//! here with signature verification: RS256 against the Supabase GoTrue
//! JWKS (loopback, never external -- CLAUDE.md rule 6), with expiry and
//! issuer checked on every request. Keys are cached in memory and
//! refreshed when a token arrives with an unknown `kid` (key rotation).
//!
//! Role mapping (D21): the GoTrue subject becomes `user_id`; the app role
//! comes from `app_metadata.app_role` (fallback `user_metadata.app_role`)
//! and maps onto [`AppRole`]. A verified token whose role is missing or
//! unknown, or that is not in the endpoint's allowed set, is FORBIDDEN --
//! the identity is real but the action is not permitted. Any signature,
//! expiry, issuer or shape failure is UNAUTHENTICATED.
//!
//! [`ProfilesStore`] is the D21 identity-to-ledger-identity seam: it maps
//! an authenticated user to their Fabric `ledger_id` (baseline
//! `profiles.ledger_id`). It is in-memory until per-request Postgres
//! wiring lands; the decide paths treat a missing entry as
//! `skipped_no_identity`, never as a silent skip.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// Application roles (baseline `app_role` enum, D21). The administrator
/// manages users, cases, cameras and templates and has no case-content
/// access; only the investigating officer confirms or rejects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum AppRole {
    Io,
    Analyst,
    Auditor,
    Admin,
}

impl AppRole {
    /// Parse the `app_role` claim value. Unknown values are rejected
    /// rather than defaulted: a invented default role would be a
    /// permission grant nobody asked for.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "io" => Some(AppRole::Io),
            "analyst" => Some(AppRole::Analyst),
            "auditor" => Some(AppRole::Auditor),
            "admin" => Some(AppRole::Admin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            AppRole::Io => "io",
            AppRole::Analyst => "analyst",
            AppRole::Auditor => "auditor",
            AppRole::Admin => "admin",
        }
    }
}

/// Verified request identity handed to handlers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthContext {
    pub user_id: Uuid,
    pub role: AppRole,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AuthError {
    #[error("UNAUTHENTICATED: {0}")]
    Unauthenticated(String),
    #[error("FORBIDDEN: {0}")]
    Forbidden(String),
}

#[derive(Debug, Deserialize)]
struct RoleHolder {
    app_role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GotrueClaims {
    sub: String,
    #[allow(dead_code)]
    exp: usize,
    #[allow(dead_code)]
    iss: String,
    app_metadata: Option<RoleHolder>,
    user_metadata: Option<RoleHolder>,
}

#[derive(Debug, Deserialize)]
struct JwksKey {
    kty: String,
    kid: String,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct JwksDocument {
    keys: Vec<JwksKey>,
}

fn default_supabase_url() -> String {
    std::env::var("SUPABASE_URL").unwrap_or_else(|_| "http://127.0.0.1:54321".into())
}

fn jwks_url_for(supabase_url: &str) -> String {
    format!("{}/auth/v1/.well-known/jwks.json", supabase_url.trim_end_matches('/'))
}

/// Cached GoTrue signing keys with refresh-on-rotation.
#[derive(Clone)]
pub struct JwksCache {
    jwks_url: String,
    expected_issuer: String,
    http: reqwest::Client,
    keys: Arc<RwLock<HashMap<String, DecodingKey>>>,
    /// Optional user directory overlay (API_CONTRACTS.md §2.11): when
    /// attached, a bearer token for a directory user with `active=false`
    /// is rejected at verification, so deactivation locks the account
    /// rather than labelling it. Users absent from the directory are
    /// unaffected — GoTrue remains the source of truth until the
    /// per-request Postgres wiring lands.
    directory: Arc<RwLock<Option<UsersStore>>>,
}

impl JwksCache {
    pub fn from_env() -> Result<Self, String> {
        let http =
            reqwest::Client::builder().timeout(Duration::from_secs(5)).build().map_err(|e| {
                format!("auth: cannot build HTTP client for GoTrue JWKS fetch: {e}")
            })?;
        Ok(Self::from_parts(jwks_url_for(&default_supabase_url()), http))
    }

    fn from_parts(jwks_url: String, http: reqwest::Client) -> Self {
        let expected_issuer = jwks_url
            .strip_suffix("/.well-known/jwks.json")
            .unwrap_or(&jwks_url)
            .to_string();
        Self {
            jwks_url,
            expected_issuer,
            http,
            keys: Arc::new(RwLock::new(HashMap::new())),
            directory: Arc::new(RwLock::new(None)),
        }
    }

    /// Test seam: an empty cache the test fills with [`JwksCache::insert_rsa_key`].
    /// No network is involved (M5-T1: no test makes a network call).
    pub fn empty_for_tests(issuer: &str) -> Self {
        Self {
            jwks_url: String::new(),
            expected_issuer: issuer.to_string(),
            http: reqwest::Client::new(),
            keys: Arc::new(RwLock::new(HashMap::new())),
            directory: Arc::new(RwLock::new(None)),
        }
    }

    /// Test seam: a cache pointed at a stub JWKS endpoint (loopback), so
    /// the refresh-on-rotation HTTP path runs against a mocked JWKS
    /// response with no external network involved.
    pub fn test_with_url(issuer: &str, jwks_url: &str) -> Self {
        Self {
            jwks_url: jwks_url.to_string(),
            expected_issuer: issuer.to_string(),
            http: reqwest::Client::new(),
            keys: Arc::new(RwLock::new(HashMap::new())),
            directory: Arc::new(RwLock::new(None)),
        }
    }

    /// Test seam: install one RSA public key the way [`JwksCache::refresh_from_json`]
    /// would after a JWKS fetch.
    pub fn insert_rsa_key(&self, kid: &str, n: &str, e: &str) {
        let key = DecodingKey::from_rsa_components(n, e).unwrap_or_else(|_| {
            DecodingKey::from_secret("invalid-test-key-material".as_ref())
        });
        if let Ok(mut keys) = self.keys.write() {
            keys.insert(kid.to_string(), key);
        }
    }

    /// Fetch the JWKS from GoTrue on startup (loopback, not external --
    /// this is not an egress violation). Failure is returned, never
    /// panicked: the server still boots and the first request retries,
    /// so a slow auth service cannot wedge startup (rule 9).
    pub async fn refresh(&self) -> Result<(), String> {
        let body = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| format!("auth: JWKS fetch from GoTrue failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("auth: GoTrue JWKS endpoint returned an error: {e}"))?
            .text()
            .await
            .map_err(|e| format!("auth: cannot read GoTrue JWKS body: {e}"))?;
        self.refresh_from_json(&body)
    }

    /// Parse a JWKS document and replace the key cache. Public so tests
    /// can drive the exact rotation path with a mocked JWKS response.
    pub fn refresh_from_json(&self, body: &str) -> Result<(), String> {
        let document: JwksDocument =
            serde_json::from_str(body).map_err(|e| format!("auth: JWKS is not valid JSON: {e}"))?;
        let mut keys = HashMap::new();
        for key in document.keys {
            if key.kty != "RSA" {
                continue;
            }
            let decoding =
                DecodingKey::from_rsa_components(&key.n, &key.e).map_err(|e| {
                    format!("auth: JWKS key {} is not a usable RSA key: {e}", key.kid)
                })?;
            keys.insert(key.kid, decoding);
        }
        match self.keys.write() {
            Ok(mut guard) => {
                *guard = keys;
                Ok(())
            }
            Err(_) => Err("auth: key cache lock poisoned".into()),
        }
    }

    fn lookup(&self, kid: &str) -> Option<DecodingKey> {
        self.keys.read().ok()?.get(kid).cloned()
    }

    /// Verify signature, expiry and issuer; extract user id and role.
    /// On an unknown `kid` the cache refreshes once (rotation) and
    /// retries before giving up.
    pub async fn verify(&self, token: &str) -> Result<AuthContext, AuthError> {
        let header = jsonwebtoken::decode_header(token)
            .map_err(|e| AuthError::Unauthenticated(format!("malformed token header: {e}")))?;
        let kid = header.kid.ok_or_else(|| {
            AuthError::Unauthenticated("token carries no key id (kid)".into())
        })?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::Unauthenticated(format!(
                "unexpected signing algorithm {:?}: RS256 required",
                header.alg
            )));
        }
        let mut key = self.lookup(&kid);
        if key.is_none() {
            // Possible rotation: one refresh, then retry once.
            if self.refresh().await.is_ok() {
                key = self.lookup(&kid);
            }
        }
        let key = key.ok_or_else(|| {
            AuthError::Unauthenticated(format!("unknown signing key {kid:?}"))
        })?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[self.expected_issuer.as_str()]);
        // GoTrue access tokens carry `"aud": "authenticated"`: pin it
        // rather than accepting any audience.
        validation.set_audience(&["authenticated"]);
        let claims = decode::<GotrueClaims>(token, &key, &validation)
            .map_err(|e| AuthError::Unauthenticated(format!("token verification failed: {e}")))?
            .claims;
        let user_id = Uuid::parse_str(&claims.sub).map_err(|_| {
            AuthError::Unauthenticated("token subject is not a user id".into())
        })?;
        let role_value = claims
            .app_metadata
            .as_ref()
            .and_then(|m| m.app_role.as_deref())
            .or_else(|| claims.user_metadata.as_ref().and_then(|m| m.app_role.as_deref()));
        let role = role_value
            .and_then(AppRole::parse)
            .ok_or_else(|| AuthError::Forbidden("token carries no recognised app role".into()))?;
        // Deactivation overlay (§2.11): a directory user flipped to
        // inactive fails authentication outright (401), on every
        // endpoint, with no per-handler check to forget.
        let deactivated = self
            .directory
            .read()
            .ok()
            .and_then(|guard| guard.clone())
            .and_then(|directory| directory.get(&user_id))
            .is_some_and(|record| !record.active);
        if deactivated {
            return Err(AuthError::Unauthenticated("account deactivated".into()));
        }
        Ok(AuthContext { user_id, role })
    }

    /// Attach the admin-managed user directory (API_CONTRACTS.md §2.11).
    /// Production calls this once at startup with the Postgres-backed
    /// directory; tests attach an in-memory one.
    pub fn set_user_directory(&self, directory: UsersStore) {
        if let Ok(mut guard) = self.directory.write() {
            *guard = Some(directory);
        }
    }
}

/// Role gate: the verified identity may proceed only when its role is in
/// the endpoint's allowed set. Design §33: hidden items are removed, not
/// disabled -- the server enforces the same boundary, so a crafted
/// request cannot reach what the sidebar hides.
pub fn require_roles(context: &AuthContext, allowed: &[AppRole]) -> Result<(), AuthError> {
    if allowed.contains(&context.role) {
        Ok(())
    } else {
        Err(AuthError::Forbidden(format!(
            "role {} is not permitted for this action",
            context.role.as_str()
        )))
    }
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

pub fn error_response(error: &AuthError) -> Response {
    let (code, status, message) = match error {
        AuthError::Unauthenticated(message) => {
            ("UNAUTHENTICATED", StatusCode::UNAUTHORIZED, message.clone())
        }
        AuthError::Forbidden(message) => ("FORBIDDEN", StatusCode::FORBIDDEN, message.clone()),
    };
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorBody {
                code,
                message,
                detail: serde_json::json!({}),
                retryable: false,
                trace_id: ulid::Ulid::new().to_string(),
            },
        }),
    )
        .into_response()
}

/// Full request authentication for handlers: Bearer presence, signature /
/// expiry / issuer verification, then the endpoint's role gate. Returns
/// the 401/403 response directly so handlers stay one line. The error
/// side is boxed: an axum `Response` is hundreds of bytes and must not
/// ride in a `Result::Err` by value (`result_large_err`).
pub async fn authenticate_request(
    headers: &HeaderMap,
    cache: &JwksCache,
    allowed: &[AppRole],
) -> Result<AuthContext, Box<axum::response::Response>> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            Box::new(error_response(&AuthError::Unauthenticated(
                "valid session required (Bearer token)".into(),
            )))
        })?;
    let context = cache.verify(token).await.map_err(|e| Box::new(error_response(&e)))?;
    require_roles(&context, allowed).map_err(|e| Box::new(error_response(&e)))?;
    Ok(context)
}

/// Investigating-officer gate shared by the confirm paths (D9
/// single-confirm discipline from M2: the auditor is read-only, the
/// analyst views, the admin has no case-content access). Returns the
/// verified user id for `decided_by`/`reviewed_by` attribution.
pub async fn authenticate_io(
    headers: &HeaderMap,
    cache: &JwksCache,
) -> Result<Uuid, Box<axum::response::Response>> {
    authenticate_request(headers, cache, &[AppRole::Io]).await.map(|context| context.user_id)
}

/// D21 identity-to-ledger-identity map (baseline `profiles.ledger_id`).
/// In-memory until per-request Postgres wiring lands; a missing entry
/// means the Fabric org is not configured for this user yet, which the
/// decide paths record as `skipped_no_identity` (warn, never silent).
#[derive(Debug, Clone, Default)]
pub struct ProfilesStore(Arc<RwLock<HashMap<Uuid, String>>>);

impl ProfilesStore {
    pub fn set_ledger_id(&self, user_id: Uuid, ledger_id: impl Into<String>) {
        if let Ok(mut guard) = self.0.write() {
            guard.insert(user_id, ledger_id.into());
        }
    }

    pub fn ledger_id(&self, user_id: &Uuid) -> Option<String> {
        self.0.read().ok()?.get(user_id).cloned()
    }

    pub fn issuer_of(cache: &JwksCache) -> String {
        cache.expected_issuer.clone()
    }
}

/// One managed user row (API_CONTRACTS.md §2.11, baseline `profiles`).
/// In-memory until per-request Postgres wiring lands; production
/// creates the matching `auth.users` entry through the GoTrue admin API.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserRecord {
    pub id: Uuid,
    pub email: String,
    pub badge_no: String,
    pub full_name: String,
    pub role: AppRole,
    pub active: bool,
}

/// Admin-managed user directory (D21). There is no delete path by
/// design: deactivation flips `active` and the row — and the audit
/// trail referencing it — survives.
#[derive(Debug, Clone, Default)]
pub struct UsersStore(Arc<RwLock<HashMap<Uuid, UserRecord>>>);

impl UsersStore {
    pub fn insert(&self, record: UserRecord) {
        if let Ok(mut guard) = self.0.write() {
            guard.insert(record.id, record);
        }
    }

    pub fn get(&self, id: &Uuid) -> Option<UserRecord> {
        self.0.read().ok()?.get(id).cloned()
    }

    /// Deterministic listing order (by email) so pageless responses and
    /// tests do not depend on hash order.
    pub fn list(&self) -> Vec<UserRecord> {
        let mut rows: Vec<UserRecord> =
            self.0.read().map(|guard| guard.values().cloned().collect()).unwrap_or_default();
        rows.sort_by(|a, b| a.email.cmp(&b.email));
        rows
    }

    pub fn email_taken(&self, email: &str) -> bool {
        self.0
            .read()
            .map(|guard| guard.values().any(|row| row.email.eq_ignore_ascii_case(email)))
            .unwrap_or(false)
    }

    /// Returns false when the id is unknown (call site answers 404).
    pub fn set_active(&self, id: &Uuid, active: bool) -> bool {
        match self.0.write() {
            Ok(mut guard) => match guard.get_mut(id) {
                Some(row) => {
                    row.active = active;
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }
}
