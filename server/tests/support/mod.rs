//! Shared M5 test doubles (doubles live here, not in production code).
//!
//! - Test-only RSA-256 keypair (`TEST_KID`): JWTs are minted with
//!   `jsonwebtoken` exactly like GoTrue mints them; the key material is
//!   generated for tests and labelled as such, never production keys.
//! - [`test_auth_cache`]: a [`JwksCache`] preloaded with the test public
//!   key -- the mocked JWKS response, no network involved.
//! - [`StubGateway`]: a loopback stub of the ledger gateway's five
//!   endpoints (API_CONTRACTS.md §5) with scripted `/verify` answers,
//!   so anchor/verify/audit tests run hermetically on 127.0.0.1.
//!
//! No test makes a network call outside loopback (M5-T1 requirement).
//!
//! Each integration-test target uses a different subset of these
//! helpers, so per-target dead-code warnings are expected and silenced
//! here (the helpers are used across the suite, just not within any
//! single target).
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use server::auth::JwksCache;
use server::ledger::LedgerClient;
use uuid::Uuid;

pub const TEST_KID: &str = "test-key-1";
pub const TEST_ISSUER: &str = "http://127.0.0.1:54321/auth/v1";

/// Base64url RSA modulus of the test keypair (test-only material).
pub const TEST_RSA_N: &str = "o4-4o_BGdIIuhKkc5loVwNpKbEHRIVAhsRxeQL5FA7xBXZpSoIgejT0BbRQ93tHX3nMwkKthYvHOnxQQAWiVR-DuFMwuIzpkp7XsB2yqbYCHj2ycRpSVY3hoKVHgsxHQ3Gr6kvdprcjg_1L_-m1rqntPajQdGxDhwxSLvbJqq7Q9SGHqUhoVRo29v9tyAyUGya5wnfjHLbuos52G_-q6M-xgMkLajrI8JhG4-gNywn8zm4_bly1gRbDU3XZNnA_Em0Wr2G1YajKgZfAxThqaZMaCEAjq6UtZ1wUgM2PeWb_vYXEmfe7z-_PTD5TLoMRPrhXHaPcJbEtlTUoL_lM_pQ";
pub const TEST_RSA_E: &str = "AQAB";

/// Test-only RSA private key (PKCS#8 PEM). Minting only; never shipped,
/// never a production key.
const TEST_RSA_PRIVATE_PEM: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCjj7ij8EZ0gi6E\nqRzmWhXA2kpsQdEhUCGxHF5AvkUDvEFdmlKgiB6NPQFtFD3e0dfeczCQq2Fi8c6f\nFBABaJVH4O4UzC4jOmSntewHbKptgIePbJxGlJVjeGgpUeCzEdDcavqS92mtyOD/\nUv/6bWuqe09qNB0bEOHDFIu9smqrtD1IYepSGhVGjb2/23IDJQbJrnCd+Mctu6iz\nnYb/6roz7GAyQtqOsjwmEbj6A3LCfzObj9uXLWBFsNTddk2cD8SbRavYbVhqMqBl\n8DFOGppkxoIQCOrpS1nXBSAzY95Zv+9hcSZ97vP789MPlMugxE+uFcdo9wlsS2VN\nSgv+Uz+lAgMBAAECggEACO6hW7qUbmpple8SV/YVeAmzxMO3YwVYQa7V6t05MaIH\nQ9BYsNGeMYJiYI2Zb2CwVEKgJVZmpBumeAOFeD444MsE1XftERlwQ8RolmM1z3MU\ndB2vTx9wJRV/Qrpo9f6EFHV3J62BRO9Scj8bIZb2KUJArQEZkc/TNG8bzok+0A+a\nY8FwGlPghRDz81owrc9iuNEIk62yj5gEPC0piiU91DNb3zK5e/0AoMxK5yFTHPSQ\nWd/8emEIYdJTMsKqd1OhwLVBGkYl8PrzZPSIQfgSUEAwfsqr3T69lct9/pm/xJKr\nQiM+PHqlniaoqBq85PUTBvf61FEr4KkwmjHoaUUp4QKBgQDXpWGUxG8U52CDpZVW\nKuRER/Ijzp+MggD9bWzrvHo9vLs6LZlQkI2xm5AMQLBXKYV3OYG6qnAGSQp2A37k\ngeaPeaVF31bSTdl544Z2/XUa2TdzD+wRJ2n5xaEuMMiGQz91mYHrbmgy472S4hEk\n7huyazuzXKZ4zdyfeWUukmPl+QKBgQDCKzQhf10eNALhh1g0BXRLLtoHFyS10mJ8\nn7cHUh5NS/m1dtmzSP+EVRSdh5idsAfgZuUeG+luGMgPF1j1g0z3Tnltzab+6bbB\nFsSgBzwd4smWQw0jlKGViGh3ebhJZswFj61l2r8u57ImzVoX4KdT8QXePM+V2jnA\nXTEkb8GiDQKBgG0oQ+rgPDJipNI+wQcrEv0VRhamAtFHBWVDPL1fXKlfnY5ngpHr\nei4LRrFNFXYpiGu/alGo8Kfd1TPDtTnKH4FE3EowMWynB4zRhUE6L0r15UGTL7XH\nM7fBOEN/YiHEbJ0EpWUdMBWCfnWZhYAiH1cDPOcf4QyJeEIpWvRmGbdRAoGBAI6q\n5AEA7lC08rD3m42NvGdJo5W2IZkfXpInYHqWkgFFo9L74vXi2yxGv4EIEtE6eG8f\n65V1+MyWlNjR1OGAelr0ZDCT/PIsk8XIjuzuo/Npoakw10SffyK6OdgfrZLxX1Nu\nwH+ofPVf9PyhwmLtBMWewSsMD5MR54E6eFNHckU5AoGALz6MzuCWxW0K4aI6Da1N\nzcHuIyCvlIKjSNJu3C+fnbwPtpyE0uFS3HGudkGjLzXgV2kM44UNQYlaJip12PPi\ncG9kN+K1Lpr+oDXgYkZm70eF5EBpYFmWWpE1TWAIxz610/paUfVPFOsGiCdouQ68\nV50gnCk5uecvPZYg2t2wwLY=\n-----END PRIVATE KEY-----\n";

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A [`JwksCache`] preloaded with the test public key: the mocked JWKS
/// response with no HTTP involved.
pub fn test_auth_cache() -> Arc<JwksCache> {
    let cache = JwksCache::empty_for_tests(TEST_ISSUER);
    cache.insert_rsa_key(TEST_KID, TEST_RSA_N, TEST_RSA_E);
    Arc::new(cache)
}

/// Mint a GoTrue-shaped RS256 JWT: `sub` user id, `exp` now+skew,
/// `iss` the test issuer, `app_metadata.app_role` the app role.
pub fn mint_token(user_id: &Uuid, role: &str, exp_skew_secs: i64) -> String {
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some(TEST_KID.to_string());
    let claims = serde_json::json!({
        "sub": user_id.to_string(),
        "exp": (now_secs() as i64 + exp_skew_secs) as u64,
        "iss": TEST_ISSUER,
        "aud": "authenticated",
        "app_metadata": { "app_role": role },
        "user_metadata": {},
    });
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_PEM.as_bytes())
        .expect("test key parses");
    jsonwebtoken::encode(&header, &claims, &key).expect("test token mints")
}

/// Mint a token with no role claim (verified identity, no permission).
pub fn mint_token_no_role(user_id: &Uuid) -> String {
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some(TEST_KID.to_string());
    let claims = serde_json::json!({
        "sub": user_id.to_string(),
        "exp": now_secs() + 3600,
        "iss": TEST_ISSUER,
        "aud": "authenticated",
        "app_metadata": {},
        "user_metadata": {},
    });
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_PEM.as_bytes())
        .expect("test key parses");
    jsonwebtoken::encode(&header, &claims, &key).expect("test token mints")
}

/// Corrupt a token's payload segment (valid structure, broken signature).
pub fn tamper_token(token: &str) -> String {
    let mut parts: Vec<String> = token.split('.').map(str::to_string).collect();
    assert_eq!(parts.len(), 3, "JWT has three segments");
    let payload = parts[1].clone();
    let first = payload.chars().next().expect("non-empty payload");
    let flipped = if first == 'A' { 'B' } else { 'A' };
    parts[1] = format!("{flipped}{}", &payload[first.len_utf8()..]);
    parts.join(".")
}

#[derive(Debug, Clone, Default)]
struct StubState {
    posts: Vec<serde_json::Value>,
    verify_map: HashMap<String, serde_json::Value>,
    counter: u64,
}

/// Loopback stub of the ledger gateway (API_CONTRACTS.md §5).
pub struct StubGateway {
    base_url: String,
    state: Arc<Mutex<StubState>>,
}

impl StubGateway {
    pub async fn start() -> Self {
        let state = Arc::new(Mutex::new(StubState::default()));
        let app = Router::new()
            .route("/anchor", post(stub_anchor))
            .route("/action", post(stub_action))
            .route("/verify/:id", get(stub_verify))
            .route("/history/:id", get(stub_history))
            .route("/health", get(stub_health))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("stub gateway binds loopback");
        let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("stub gateway serves");
        });
        Self { base_url, state }
    }

    pub fn client(&self) -> LedgerClient {
        LedgerClient::new(&self.base_url).expect("stub ledger client builds")
    }

    /// Script one `/verify` answer: the anchored hash plus endorsements.
    pub fn set_verify(&self, object_id: &str, hash: &str, endorsements: serde_json::Value) {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        let tx_id = format!("stub-tx-{}", state.counter);
        state.verify_map.insert(
            object_id.to_string(),
            serde_json::json!({
                "txId": tx_id,
                "hash": hash,
                "ts": "2025-11-02T14:00:00Z",
                "endorsements": endorsements,
            }),
        );
    }

    /// Bodies received on POST /anchor and POST /action, in order.
    pub fn posts(&self) -> Vec<serde_json::Value> {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).posts.clone()
    }
}

async fn stub_mutation(
    State(state): State<Arc<Mutex<StubState>>>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.counter += 1;
    guard.posts.push(body);
    let counter = guard.counter;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "txId": format!("stub-tx-{counter}"),
            "blockNo": counter,
            "ts": "2025-11-02T14:00:00Z",
        })),
    )
}

async fn stub_anchor(
    State(state): State<Arc<Mutex<StubState>>>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    stub_mutation(State(state), Json(body)).await
}

async fn stub_action(
    State(state): State<Arc<Mutex<StubState>>>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    stub_mutation(State(state), Json(body)).await
}

async fn stub_verify(
    State(state): State<Arc<Mutex<StubState>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    match guard.verify_map.get(&id) {
        Some(entry) => (StatusCode::OK, Json(entry.clone())),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": {"code": "NOT_FOUND"}})),
        ),
    }
}

async fn stub_history(
    State(state): State<Arc<Mutex<StubState>>>,
    Path(_id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let _ = state;
    (StatusCode::OK, Json(serde_json::json!([])))
}

async fn stub_health() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::OK,
        Json(serde_json::json!({"mode": "mock", "orgs": ["mock"], "peers": ["mock-peer"]})),
    )
}
