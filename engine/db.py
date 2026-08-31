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


async def persist_extraction_to_db(
    case_code: str,
    file_id: str,
    filename: str,
    mime_type: str,
    byte_size: int,
    sha256: str,
    ledger_tx_id: str,
    ledger_status: str,
    extraction: dict,
) -> dict:
    """Persist an ingested document and its extracted NLP entities, identifiers,
    relationships, and evidence spans into the Supabase Postgres database."""
    import json
    import uuid

    # Ensure file_id is a valid UUID
    try:
        file_uuid = str(uuid.UUID(file_id))
    except Exception:
        file_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, file_id))

    pool = await get_pool()
    async with pool.acquire() as conn:
        # 1. Ensure Case exists
        case_id = await conn.fetchval(
            "SELECT id::text FROM cases WHERE case_code = $1", case_code
        )
        if not case_id:
            case_id = await conn.fetchval(
                "INSERT INTO cases (id, case_code, title) VALUES (gen_random_uuid(), $1, 'Active Investigation') RETURNING id::text",
                case_code,
            )

        # 2. Insert or update source_files row
        storage_path = f"cases/{case_code}/{file_uuid}"
        extracted_text = extraction.get("text", "")
        page_map_json = json.dumps(extraction.get("page_map", []))

        await conn.execute(
            """INSERT INTO source_files 
               (id, case_id, filename, mime_type, byte_size, sha256, storage_path, source, status, ledger_tx_id, ledger_status, extracted_text, page_map)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'MANUAL'::source_node, 'committed'::ingest_status, $8, $9, $10, $11::jsonb)
               ON CONFLICT (id) DO UPDATE SET 
                   status = 'committed'::ingest_status, 
                   ledger_tx_id = EXCLUDED.ledger_tx_id,
                   ledger_status = EXCLUDED.ledger_status,
                   extracted_text = EXCLUDED.extracted_text,
                   page_map = EXCLUDED.page_map""",
            file_uuid,
            case_id,
            filename,
            mime_type,
            byte_size,
            sha256,
            storage_path,
            ledger_tx_id,
            ledger_status,
            extracted_text,
            page_map_json,
        )

        # 3. Persist Entities
        ALLOWED_ENTITY_TYPES = {"PERSON", "ORGANIZATION", "LOCATION", "VEHICLE", "ACCOUNT"}
        entities_count = 0
        for e in extraction.get("entities", []):
            etype = (e.get("type") or "PERSON").upper()
            if etype not in ALLOWED_ENTITY_TYPES:
                etype = "PERSON"
            eid = e.get("id")
            name = e.get("name", "").strip()
            if not eid or not name:
                continue
            await conn.execute(
                """INSERT INTO entities (id, case_id, type, canonical_name, sync_state)
                   VALUES ($1::uuid, $2::uuid, $3::entity_type, $4, 'pending')
                   ON CONFLICT (id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name""",
                eid,
                case_id,
                etype,
                name,
            )
            entities_count += 1

            # Insert aliases if any
            for alias in e.get("aliases", []):
                norm = alias.lower().strip()
                if norm:
                    try:
                        await conn.execute(
                            """INSERT INTO entity_aliases (entity_id, alias, normalized)
                               VALUES ($1::uuid, $2, $3) ON CONFLICT (entity_id, normalized) DO NOTHING""",
                            eid,
                            alias,
                            norm,
                        )
                    except Exception:
                        pass

        # 4. Persist Identifiers
        ALLOWED_ID_TYPES = {"PHONE", "VEHICLE", "ACCOUNT", "IMEI", "NAFIS"}
        identifiers_count = 0
        for i in extraction.get("identifiers", []):
            eid = i.get("entity_id")
            if not eid:
                continue
            itype = (i.get("type") or "PHONE").upper()
            if itype == "UPI":
                itype = "ACCOUNT"
            elif itype not in ALLOWED_ID_TYPES:
                itype = "PHONE"
            val = str(i.get("value", "")).strip()
            if val:
                try:
                    await conn.execute(
                        """INSERT INTO identifiers (entity_id, type, value, source_file_id)
                           VALUES ($1::uuid, $2::identifier_type, $3, $4::uuid)
                           ON CONFLICT (type, value, entity_id) DO NOTHING""",
                        eid,
                        itype,
                        val,
                        file_uuid,
                    )
                    identifiers_count += 1
                except Exception:
                    pass

        # 5. Persist Relationships
        ALLOWED_REL_TYPES = {
            "CALLED",
            "TRANSFERRED_TO",
            "CO_ACCUSED",
            "CO_LOCATED",
            "RESIDES_WITH",
            "SEEN_WITH",
        }
        relations_count = 0
        for r in extraction.get("relations", []):
            src = r.get("src")
            dst = r.get("dst")
            if not src or not dst:
                continue
            rtype = (r.get("type") or "CO_ACCUSED").upper()
            if rtype not in ALLOWED_REL_TYPES:
                rtype = "CO_LOCATED"
            rid = r.get("id") or str(uuid.uuid4())
            try:
                await conn.execute(
                    """INSERT INTO relationships 
                       (id, case_id, src_entity_id, dst_entity_id, type, weight, raw_score, evidence_count, sync_state)
                       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::rel_type, 1.0, 1.0, 1, 'pending')
                       ON CONFLICT (src_entity_id, dst_entity_id, type)
                       DO UPDATE SET evidence_count = relationships.evidence_count + 1, weight = relationships.weight + 0.1""",
                    rid,
                    case_id,
                    src,
                    dst,
                    rtype,
                )
                relations_count += 1
            except Exception:
                pass

        # 6. Persist Evidence Items
        evidence_count = 0
        for ev in extraction.get("evidence", []):
            rel_id = ev.get("relationship_id") or None
            ent_id = ev.get("entity_id") or None
            kind = ev.get("kind", "fir_text")
            snippet = ev.get("snippet", "")
            cs = ev.get("char_start")
            ce = ev.get("char_end")
            try:
                await conn.execute(
                    """INSERT INTO evidence (relationship_id, entity_id, source_file_id, kind, snippet, char_start, char_end, confidence)
                       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 0.9)""",
                    rel_id,
                    ent_id,
                    file_uuid,
                    kind,
                    snippet,
                    cs,
                    ce,
                )
                evidence_count += 1
            except Exception:
                pass

        # 7. Audit Log Entry
        try:
            await conn.execute(
                """INSERT INTO audit_log (action, object_type, object_id, payload_hash)
                   VALUES ('file.committed', 'source_file', $1, $2)""",
                file_uuid,
                sha256,
            )
        except Exception:
            pass

    return {
        "persisted": True,
        "case_id": case_id,
        "file_uuid": file_uuid,
        "entities_persisted": entities_count,
        "identifiers_persisted": identifiers_count,
        "relationships_persisted": relations_count,
        "evidence_persisted": evidence_count,
    }

