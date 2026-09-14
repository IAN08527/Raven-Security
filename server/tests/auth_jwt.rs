//! M5-T1. Real GoTrue JWT verification tests (D21).
//!
//! - A valid token for an io role passes verification.
//! - An expired token returns UNAUTHENTICATED.
//! - A token with tampered payload returns UNAUTHENTICATED.
//! - A valid io token attempting an admin-gated action returns FORBIDDEN.
//! - Unknown `kid` triggers one JWKS refresh (mocked JWKS response over
//!   loopback) before failing; a rotation that the refresh carries
//!   verifies on retry.
//!
//! No test makes a network call outside loopback: keys are test-only
//! material minted in-process, the JWKS document is canned JSON.

#[path = "support/mod.rs"]
mod support;

use server::auth::{require_roles, AppRole, AuthError, JwksCache};
use uuid::Uuid;

fn io_token(user: &Uuid) -> String {
    support::mint_token(user, "io", 3600)
}

#[tokio::test]
async fn valid_io_token_passes_verification() {
    let user = Uuid::new_v4();
    let cache = support::test_auth_cache();
    let context = cache.verify(&io_token(&user)).await.expect("valid token verifies");
    assert_eq!(context.user_id, user);
    assert_eq!(context.role, AppRole::Io);
}

#[tokio::test]
async fn expired_token_returns_unauthenticated() {
    let cache = support::test_auth_cache();
    let token = support::mint_token(&Uuid::new_v4(), "io", -3600);
    let error = cache.verify(&token).await.expect_err("expired token must fail");
    assert!(matches!(error, AuthError::Unauthenticated(_)), "got {error:?}");
}

#[tokio::test]
async fn tampered_payload_returns_unauthenticated() {
    let cache = support::test_auth_cache();
    let token = support::tamper_token(&io_token(&Uuid::new_v4()));
    let error = cache.verify(&token).await.expect_err("tampered token must fail");
    assert!(matches!(error, AuthError::Unauthenticated(_)), "got {error:?}");
}

#[tokio::test]
async fn io_token_on_admin_action_returns_forbidden() {
    let cache = support::test_auth_cache();
    let context = cache.verify(&io_token(&Uuid::new_v4())).await.expect("valid token verifies");
    let error = require_roles(&context, &[AppRole::Admin]).expect_err("io may not act as admin");
    assert!(matches!(error, AuthError::Forbidden(_)), "got {error:?}");
}

#[tokio::test]
async fn token_without_role_is_forbidden_not_unauthenticated() {
    let cache = support::test_auth_cache();
    let token = support::mint_token_no_role(&Uuid::new_v4());
    let error = cache.verify(&token).await.expect_err("role-less token must fail");
    assert!(matches!(error, AuthError::Forbidden(_)), "got {error:?}");
}

#[tokio::test]
async fn unknown_kid_refreshes_once_then_fails_closed() {
    // Empty cache pointed at an unreachable JWKS URL: refresh fails, so
    // the unknown key stays unknown and verification fails closed (401,
    // never a bypass).
    let cache = JwksCache::test_with_url(support::TEST_ISSUER, "http://127.0.0.1:1/jwks.json");
    let error = cache.verify(&io_token(&Uuid::new_v4())).await.expect_err("unknown kid must fail");
    assert!(matches!(error, AuthError::Unauthenticated(_)), "got {error:?}");
}

#[tokio::test]
async fn rotation_carried_by_refresh_verifies_on_retry() {
    // Mocked JWKS response served over loopback: the cache starts empty
    // (unknown kid), refreshes once, and the retried verification passes.
    let jwks = serde_json::json!({
        "keys": [{
            "kty": "RSA",
            "kid": support::TEST_KID,
            "n": support::TEST_RSA_N,
            "e": support::TEST_RSA_E,
        }]
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("binds loopback");
    let url = format!("http://{}/jwks.json", listener.local_addr().expect("addr"));
    tokio::spawn(async move {
        let app = axum::Router::new().route(
            "/jwks.json",
            axum::routing::get(move || {
                let body = jwks.to_string();
                async move { body }
            }),
        );
        axum::serve(listener, app).await.expect("serves");
    });
    let cache = JwksCache::test_with_url(support::TEST_ISSUER, &url);
    let user = Uuid::new_v4();
    let context = cache.verify(&io_token(&user)).await.expect("rotation refresh verifies");
    assert_eq!(context.user_id, user);
}

#[test]
fn unknown_role_value_parses_to_none() {
    assert_eq!(AppRole::parse("superuser"), None);
    assert_eq!(AppRole::parse("io"), Some(AppRole::Io));
}
