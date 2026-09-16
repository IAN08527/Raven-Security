//! Content-addressed blob store (D34, D5).
//!
//! Blobs are keyed by SHA-256: `{base_dir}/{sha256[0..2]}/{sha256}`.
//! Writes are idempotent — a second write of identical bytes returns the
//! existing path without touching the file — which is what makes global
//! SHA-256 deduplication safe: two cases may reference the same bytes,
//! and neither upload disturbs the other. Blobs are never mutated or
//! deleted by this service (FR-1.2 content-addressing); the tamper
//! flow in `api::files` re-hashes these exact bytes.

use std::path::PathBuf;

/// Blob I/O failure. Surfaces to the upload handler as `INTERNAL`;
/// to the saga as a failed job row (rule 9 — never a silent drop).
#[derive(Debug, thiserror::Error)]
pub enum BlobError {
    #[error("blob I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

/// Content-addressed file store rooted at `base_dir` (`RAVEN_BLOB_DIR`,
/// default `./blobs`).
#[derive(Debug, Clone)]
pub struct BlobStore {
    base_dir: PathBuf,
}

impl BlobStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    /// Directory shard for a hash: the first two hex chars, so no single
    /// directory holds every blob.
    fn shard(sha256: &str) -> &str {
        sha256.get(..2).unwrap_or(sha256)
    }

    /// Full path for a hash, creating nothing.
    pub fn path_for(&self, sha256: &str) -> PathBuf {
        self.base_dir.join(Self::shard(sha256)).join(sha256)
    }

    /// Write bytes idempotently. An existing blob is returned as-is:
    /// identical content needs no second write.
    pub async fn write(&self, sha256: &str, bytes: &[u8]) -> Result<PathBuf, BlobError> {
        let path = self.path_for(sha256);
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Ok(path);
        }
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, bytes).await?;
        Ok(path)
    }

    /// Read a blob's bytes. `Err` when the blob was never written —
    /// the caller fails loud (rule 9), never hashes substitute bytes.
    pub async fn read(&self, sha256: &str) -> Result<Vec<u8>, BlobError> {
        Ok(tokio::fs::read(self.path_for(sha256)).await?)
    }

    /// Whether the blob is on disk.
    pub async fn exists(&self, sha256: &str) -> bool {
        tokio::fs::try_exists(self.path_for(sha256)).await.unwrap_or(false)
    }

    /// Test seam: this store's root.
    #[cfg(test)]
    fn base_dir(&self) -> PathBuf {
        self.base_dir.clone()
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    fn sha_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Isolated root per test: the OS temp dir plus a fresh UUID, so
    /// parallel tests never share a blob directory.
    fn test_store() -> BlobStore {
        let root =
            std::env::temp_dir().join(format!("raven-blob-test-{}", uuid::Uuid::new_v4()));
        BlobStore::new(root)
    }

    #[tokio::test]
    async fn write_then_read_returns_identical_bytes() {
        let store = test_store();
        let bytes = b"seized letter, page one";
        let sha = sha_hex(bytes);
        let path = store.write(&sha, bytes).await.expect("write works");
        assert_eq!(path, store.path_for(&sha));
        assert!(path.starts_with(store.base_dir()));
        let back = store.read(&sha).await.expect("read works");
        assert_eq!(back, bytes);
        let _ = tokio::fs::remove_dir_all(store.base_dir()).await;
    }

    #[tokio::test]
    async fn second_write_returns_existing_path_without_error() {
        let store = test_store();
        let bytes = b"same bytes twice";
        let sha = sha_hex(bytes);
        let first = store.write(&sha, bytes).await.expect("first write works");
        let second = store.write(&sha, bytes).await.expect("second write works");
        assert_eq!(first, second, "duplicate write returns the existing path");
        assert_eq!(store.read(&sha).await.expect("read works"), bytes);
        let _ = tokio::fs::remove_dir_all(store.base_dir()).await;
    }

    #[tokio::test]
    async fn exists_is_false_before_write_and_true_after() {
        let store = test_store();
        let sha = sha_hex(b"not yet stored");
        assert!(!store.exists(&sha).await, "missing blob does not exist");
        store.write(&sha, b"not yet stored").await.expect("write works");
        assert!(store.exists(&sha).await, "stored blob exists");
        let _ = tokio::fs::remove_dir_all(store.base_dir()).await;
    }
}
