# Stack

Every dependency, its job, and how its version is decided.

Two categories. **Pinned** means the version is fixed here and changes only in a
deliberate commit. **Verify and record** means the working version depends on
local hardware and driver state, so the first person to get it working writes the
combination into §6 and everyone else uses that. Do not guess at a
verify-and-record version. Run the check, then write down what worked.

Rule: adding a dependency means adding a row here, with what it is for. A library
that phones home is disqualified regardless of how good it is (CLAUDE.md rule 6).

---

## 1. Native client

| Package | Version | Job |
|:---|:---|:---|
| Rust toolchain | pinned via `rust-toolchain.toml`, stable channel | Client and server |
| Tauri | 2.x | Desktop shell, WebView2 |
| tauri-plugin-fs | matching Tauri 2.x | Scoped filesystem access |
| tokio | 1.x | Async runtime |
| reqwest | 0.12.x | HTTP client, `rustls-tls`, never `native-tls` |
| serde / serde_json | 1.x | Serialisation |
| thiserror / anyhow | 1.x | Errors, per CLAUDE.md conventions |
| sha2 | 0.10.x | Streaming file hashing |
| infer | 0.15.x | Magic-byte MIME sniffing, never extensions |
| ulid | 1.x | Trace ids |

## 2. Server

| Package | Version | Job |
|:---|:---|:---|
| axum | 0.7.x | HTTP API |
| tokio-tungstenite | 0.23.x | WebSocket |
| sqlx | 0.8.x | Postgres, compile-time checked queries |
| neo4rs | 0.8.x | Bolt driver, sole writer (D10) |
| reqwest | 0.12.x | HTTP client to the ledger gateway (§5 API_CONTRACTS.md), `rustls-tls`. Added M0-T8 for the health gate's ledger check; same pin as the native client's copy |
| tower-http | 0.5.x | TLS, tracing, limits |
| jsonwebtoken | 9.x | GoTrue token verification |
| tracing / tracing-subscriber | 0.1.x / 0.3.x | Structured logs with trace ids |
| time | 0.3.x | `OffsetDateTime` for the case clock (D16, M1-T1); not `chrono`, which sqlx's `chrono` feature still pulls transitively for its own row mapping |
| uuid | 1.x | Entity/camera/etc ids, matching the baseline schema's `uuid` PKs and API_CONTRACTS.md §1.3 |
| ulid | 1.x | `trace_id` in the error envelope (API_CONTRACTS.md §1.1), matching the native client's copy |
| sha2 | 0.10.x | SHA-256 of the canonical extraction JSON for the D5 ledger anchor (M4-T2). Pure Rust, no network |

## 3. Frontend

| Package | Version | Job |
|:---|:---|:---|
| React | 18.x | UI |
| TypeScript | 5.x, `strict: true` | Types |
| Vite | 5.x | Build |
| Tailwind | 3.x | Styling |
| Cytoscape.js | 3.30.x | Graph rendering |
| cytoscape-fcose | 2.x | Layout. fCoSE, `randomize: false`, cached |
| MapLibre GL JS | 4.x | Map |
| pmtiles | 3.x | Local basemap, no tile server (D6) |
| Zustand | 4.x | State |

No charting or icon library that loads from a CDN. Fonts are bundled.

## 4. Python, both lanes

| Package | Version | Job |
|:---|:---|:---|
| Python | 3.11 | Both lanes |
| FastAPI | 0.115.x | HTTP + WS |
| uvicorn | 0.30.x | ASGI |
| pydantic | 2.x | Every model boundary |
| numpy | 1.26.x | Arrays. Check consumer compatibility before moving to 2.x |
| psycopg | 3.x | Postgres |
| neo4j | 5.x | Read-only Bolt |
| PyAV | verify and record | Decode, hardware accelerated |
| ultralytics | verify and record | Detector |
| torch / torchvision | verify and record | See §6 |
| TensorRT | verify and record | FP16 export for detector and embedder |
| onnx / onnxruntime-gpu | verify and record | Export path and fallback |
| opencv-python-headless | 4.10.x | Preprocessing only, not decode |
| scipy / scikit-learn | 1.14.x / 1.5.x | Routine clustering, CPU |
| pytest / ruff / mypy | current | Tests, lint, types |
| httpx | 0.28.x | Engine node -> server registration (M1-T3, `POST /v1/nodes`) and any other outbound HTTP the Python lanes need |
| python-ulid | 4.x | `trace_id` in Python-side events (API_CONTRACTS.md §1.1/§1.2), matching the Rust `ulid` crate's convention |

## 5. Models

| Model | Selection | Job |
|:---|:---|:---|
| Detector | YOLOv8n or v11n, person class only | Pedestrian detection. Size chosen by S1, not assumed |
| Tracker | ByteTrack | Stable track ids within a camera |
| Re-ID embedder | OSNet x1.0 or x0.25, 512-d | Appearance embedding. Variant chosen by S2 |
| Script ID | Small CNN, trained in-repo | Per-line script classification (FR-2.3) |
| Line recogniser | PARSeq or CRNN, shared Unicode charset | Multi-script HTR (D17) |
| English handwriting baseline | TrOCR base handwritten | Comparison point for S3 |
| Layout and lines | docTR or Kraken | Segmentation (FR-2.2) |
| NER / extraction LLM | 1.5B-2B class at Q4 via Ollama | Sized by what §6 leaves free |

Model weights are pulled once and cached locally. No runtime downloads, no hosted
inference, ever.

## 6. Verify and record

The GPU stack is the one place where a wrong version costs a day. Record the
working combination here rather than trusting a guess.

**Reference machine.** RTX 4050 Laptop, 6GB. Ada Lovelace, compute capability 8.9,
which is covered by mainstream CUDA 12.x builds. The prototype documents worried
about a Blackwell card needing an unusual wheel; that concern does not apply to
this GPU, so standard cu12x wheels are the starting point.

**Procedure.** Install, then verify before writing any inference code:

```bash
python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
python -c "import torch; print(torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
nvidia-smi                    # driver version must satisfy the CUDA runtime
python -c "import tensorrt; print(tensorrt.__version__)"
python -c "import av; print(av.__version__)"   # confirm hwaccel decoders present
```

Then run a single batched forward pass and confirm VRAM headroom matches
expectation. If any of the above fails, fix it before proceeding. A GPU stack that
half works produces confusing failures three layers up.

**Record the working combination:**

| Item | Version | Verified on | Date |
|:---|:---|:---|:---|
| NVIDIA driver | 560.76 | RTX 4050 Laptop, 6GB (reference machine) | 2026-09-11 |
| CUDA runtime | 12.6 | same | 2026-09-11 |
| torch | 2.8.0+cu126 | same | 2026-09-11 |
| torchvision | 0.23.0+cu126 | same | 2026-09-11 |
| TensorRT | 11.3.0.99 | same | 2026-09-11 |
| onnxruntime-gpu | 1.30.0 | same | 2026-09-11 |
| PyAV | 18.1.0 | same | 2026-09-11 |
| ultralytics | 8.4.147 | same | 2026-09-11 |

Install notes (M0-T2):

- `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126`.
  cu121/cu124 wheels also exist for this Python version, but cu126 matches the
  driver's reported CUDA 12.6 most closely.
- Plain `pip install tensorrt` resolves to the latest release, which targets
  CUDA 13 (`tensorrt-cu13-libs`) and failed here because its installer
  fetches that placeholder from `pypi.nvidia.com`, which this network could
  not reach. `pip install tensorrt-cu12` (the explicit CUDA-12 variant)
  installed cleanly instead and imports the same `tensorrt` module.
- `torch.cuda.get_device_capability(0)` returned `(8, 9)`, confirming Ada
  Lovelace / compute capability 8.9 as documented above.
- `av.codecs_available` includes `h264_cuvid` and `hevc_cuvid` (plus
  `hevc_nvenc`, `av1_cuvid`, and others) -- hardware decode is present, not
  falling back to software.
- Batched forward pass: YOLOv8n (`ultralytics`, weights pulled once and
  cached locally per §5), batch of 8 at 640x640, FP32, on `cuda:0`. VRAM
  free before: 5321.5MB of 6438.8MB total. After: 4973.4MB free, 137.4MB
  allocated, 333.4MB reserved by torch's caching allocator -- 348.1MB of
  headroom used for this batch/resolution. Matches the expectation in §3.4
  (detector: 0.8-1.5GB budgeted at batched TensorRT FP16; this run was
  FP32 and unbatched-optimized, so a smaller number here is expected and
  consistent, not a discrepancy).

## 7. Infrastructure

| Component | Version | Notes |
|:---|:---|:---|
| Postgres | 17, was 16 | Via Supabase local. Repinned in M0-T3: Supabase CLI 2.117.0 rejects `db.major_version = 16` outright ("Invalid db.major_version: 16"); 17 is the version its `supabase init` template offers and the local image (`public.ecr.aws/supabase/postgres:17.6.1.167`) actually starts. Baseline migration, RLS and the HNSW index were all verified against this image in M0-T3/M0-T4 |
| pgvector | 0.5+ required, confirmed 0.8.2 | Verified 2026-09-11 via `SELECT extversion FROM pg_extension WHERE extname='vector'` against the Postgres 17 local image above. Above the 0.5 floor, HNSW index in the baseline migration used as-is |
| Supabase CLI | current | `supabase/migrations/` is the only schema location |
| Neo4j | 5 Community | Docker, one container. `neo4j:5-community` image (M0-T8) |
| Node | 20 LTS | Ledger gateway and chaincode only |
| Hyperledger Fabric | 2.5.x LTS | Multi-org (D22) |
| Docker Desktop | current, WSL2 backend | Required for the data layer |
| `pgvector/pgvector:pg17` | M0-T8 only | Postgres image for `infra/compose/all-in-one.yml`, not the Supabase-flavoured image `supabase start` uses. That image hardcodes `supabase_admin` as the role its own init scripts run as, which fights a plain `POSTGRES_USER` override; this compose runs no GoTrue/PostgREST to make that assumption correct anyway. Confirmed pgvector 0.8.6 |

Supabase services enabled: Postgres, GoTrue, PostgREST, Storage.
Disabled: analytics (Logflare), imgproxy, edge-runtime, inbucket, realtime (D12).

## 8. Excluded, and why

| Not used | Reason |
|:---|:---|
| Mapbox, Google Maps, any hosted tiles | Third-party egress of location data (D6) |
| Hosted LLM or OCR APIs | Case content must not leave the premises |
| DukeMTMC | Withdrawn over consent problems (`EVALUATION.md`) |
| Milvus, Qdrant, FAISS | pgvector keeps vector, sighting and evidence in one transaction (D7) |
| Sentry or any hosted telemetry | Egress. Logs stay local |
| CDN-hosted fonts or scripts | Egress, and breaks on an isolated network |
