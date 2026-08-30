"""Async Postgres access layer for the Raven intelligence engine.

Wires the Python side of the storage baseline to the cloud Supabase project
(Session 1a). Uses asyncpg with a shared pool; `statement_cache_size=0` keeps
us compatible with Supabase's transaction pooler (PgBouncer) which does not
support server-side prepared statements.
"""
import os
import asyncio
import asyncpg


def build_dsn() -> str:
    """Return a Postgres DSN.

    Priority:
      1. ``RAVEN_PG_DSN`` (full DSN — set in ``.env`` to the Supabase pooler).
      2. Assembled from ``SUPABASE_*`` env vars with the ``postgres.<ref>`` role
         that the Supabase pooler requires.
    """
    dsn = os.environ.get("RAVEN_PG_DSN")
    if dsn:
        return dsn

    host = os.environ.get("SUPABASE_DB_HOST", "db.nszgciwmpdejpvoywgav.supabase.co")
    port = os.environ.get("SUPABASE_DB_PORT", "5432")
    password = os.environ.get("SUPABASE_DB_PASSWORD", "")
    db = os.environ.get("SUPABASE_DB_NAME", "postgres")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF", "")
    user = os.environ.get("SUPABASE_DB_USER", "postgres")

    if "pooler.supabase.co" in host and project_ref and "." not in user:
        user = f"{user}.{project_ref}"

    from urllib.parse import quote_plus

    return f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{db}"


_POOL: "asyncpg.Pool | None" = None


def _dsn_components():
    """Parse ``RAVEN_PG_DSN`` into explicit asyncpg connect kwargs.

    asyncpg's ``create_pool(dsn=...)`` mishandles some URL-encoded passwords,
    so we pass components explicitly. Falls back to assembling from
    ``SUPABASE_*`` env vars.
    """
    import urllib.parse

    dsn = os.environ.get("RAVEN_PG_DSN")
    if dsn:
        parts = urllib.parse.urlsplit(dsn)
        user = parts.username or "postgres"
        password = urllib.parse.unquote(parts.password or "")
        host = parts.hostname or "localhost"
        port = parts.port or 5432
        database = (parts.path or "/postgres").lstrip("/") or "postgres"
        return dict(user=user, password=password, host=host, port=port, database=database)

    host = os.environ.get("SUPABASE_DB_HOST", "db.nszgciwmpdejpvoywgav.supabase.co")
    port = int(os.environ.get("SUPABASE_DB_PORT", "5432"))
    password = os.environ.get("SUPABASE_DB_PASSWORD", "")
    database = os.environ.get("SUPABASE_DB_NAME", "postgres")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF", "")
    user = os.environ.get("SUPABASE_DB_USER", "postgres")
    if "pooler.supabase.co" in host and project_ref and "." not in user:
        user = f"{user}.{project_ref}"
    return dict(user=user, password=password, host=host, port=port, database=database)


async def get_pool() -> "asyncpg.Pool":
    global _POOL
    if _POOL is None:
        _POOL = await asyncpg.create_pool(
            min_size=1,
            max_size=5,
            statement_cache_size=0,
            command_timeout=15,
            **_dsn_components(),
        )
    return _POOL


async def close_pool() -> None:
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None


async def db_health() -> bool:
    """Real liveness probe: ``SELECT 1`` against the cloud Supabase DB."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            return await conn.fetchval("SELECT 1") == 1
    except Exception:
        return False


async def count_source_files() -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT count(*) FROM source_files")


async def list_cases():
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(
            "SELECT id::text, case_code, title FROM cases ORDER BY opened_at DESC LIMIT 50"
        )


_CAMERA_ID_CACHE: "dict[str, str]" = {}


async def resolve_camera_id(code: str) -> "str | None":
    """Map a camera code ('cam_02') to its UUID; cached (camera rows are static)."""
    if code in _CAMERA_ID_CACHE:
        return _CAMERA_ID_CACHE[code]
    pool = await get_pool()
    async with pool.acquire() as conn:
        cid = await conn.fetchval("SELECT id::text FROM cameras WHERE code = $1", code)
    if cid:
        _CAMERA_ID_CACHE[code] = cid
    return cid


async def insert_reid_sighting(
    target_id: str,
    camera_id: str,
    ts: str,
    similarity: float,
    bbox: "list[int]",
    frame_path: "str | None",
) -> int:
    """Insert one `reid_sightings` row (Phase 3). Returns the new sighting id.

    A sighting is a *candidate* re-appearance, not yet an accountable act — the
    officer's confirm (Phase 5) is what anchors and feeds the graph. So this is
    a plain engine-side write, no ledger.
    """
    from decimal import Decimal

    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO reid_sightings "
            "(target_id, camera_id, ts, similarity, bbox, frame_path) "
            "VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4, $5, $6) "
            "RETURNING id",
            target_id,
            camera_id,
            ts,
            Decimal(f"{float(similarity):.4f}"),
            [int(v) for v in bbox],
            frame_path,
        )


async def schema_present() -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            """SELECT count(*) FROM information_schema.tables
               WHERE table_schema='public' AND table_name IN
               ('officers','cases','source_files','entities','relationships',
                'evidence','cdr_records','financial_txns','audit_log','reid_targets')"""
        )
        return count >= 10


async def ensure_connected() -> None:
    """Eagerly establish the pool at startup so the health gate is accurate."""
    await get_pool()
