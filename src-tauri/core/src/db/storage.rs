//! Supabase Storage client (cloud blob store).
//!
//! Writes go through the Storage REST API using the *service role* key so they
//! bypass Row-Level Security (this is a backend, not a browser). The file
//! bytes are uploaded once at ingest (saga step 3) and the returned object key
//! is stored in `source_files.storage_path`.

use reqwest::Client;

pub struct SupabaseStorage {
    base: String, // https://<ref>.supabase.co/storage/v1
    key: String,
    bucket: String,
    client: Client,
}

impl SupabaseStorage {
    /// Build from env: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
    /// (falls back to `SUPABASE_ANON_KEY`). Returns `None` if those are absent.
    pub fn from_env() -> Option<Self> {
        let url = std::env::var("SUPABASE_URL").ok()?;
        let key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .ok()
            .or_else(|| std::env::var("SUPABASE_ANON_KEY").ok())?;
        let bucket = std::env::var("RAVEN_BUCKET").unwrap_or_else(|_| "evidence".into());
        let base = format!("{}/storage/v1", url.trim_end_matches('/'));
        Some(Self {
            base,
            key,
            bucket,
            client: Client::new(),
        })
    }

    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("Authorization", format!("Bearer {}", self.key))
            .header("apikey", &self.key)
    }

    /// Create the bucket if it does not exist yet. Tolerates "already exists".
    pub async fn ensure_bucket(&self) -> Result<(), String> {
        let url = format!("{}/bucket", self.base);
        let resp = self
            .auth(self.client.post(&url))
            .json(&serde_json::json!({ "name": self.bucket, "public": false }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        if status == 200 || status == 201 || status == 409 {
            return Ok(());
        }
        let txt = resp.text().await.unwrap_or_default();
        if txt.contains("already exists") {
            return Ok(());
        }
        Err(format!("ensure_bucket {} -> {}", status, txt))
    }

    /// Upload (upsert) an object. `key` is the object path, e.g.
    /// `cases/<case_id>/<file_id>`.
    pub async fn upload(&self, key: &str, bytes: &[u8], content_type: &str) -> Result<(), String> {
        let url = format!("{}/object/{}/{}", self.base, self.bucket, key);
        let resp = self
            .auth(self.client.post(&url))
            .header("x-upsert", "true")
            .header("content-type", content_type)
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("upload {} -> {}", status, txt));
        }
        Ok(())
    }

    /// Download an object's bytes. Used by the verify-evidence / export flows.
    pub async fn download(&self, key: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/object/{}/{}", self.base, self.bucket, key);
        let resp = self
            .auth(self.client.get(&url))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("download {}", resp.status()));
        }
        Ok(resp.bytes().await.map_err(|e| e.to_string())?.to_vec())
    }
}
