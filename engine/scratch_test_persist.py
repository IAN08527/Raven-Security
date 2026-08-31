import asyncio
import httpx
import dotenv
dotenv.load_dotenv()
import probe_db
import db as db_layer

async def test_e2e():
    # 1. Upload via the live pipeline endpoint
    sample = "../assets/sample_fir_124.pdf"
    with open(sample, "rb") as f:
        pdf_bytes = f.read()

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "http://127.0.0.1:8756/pipeline/upload",
            files={"file": ("sample_fir_124.pdf", pdf_bytes, "application/pdf")},
            data={"case_id": "OP-RAVEN-01", "category": "fir", "source": "WEB_UPLOAD"},
        )
        result = resp.json()
        print("Upload status:", result.get("status"))
        print("DB persistence:", result.get("db_persistence"))

    # 2. Verify data in Supabase
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        case_id = await conn.fetchval("SELECT id::text FROM cases WHERE case_code = 'OP-RAVEN-01'")
        print(f"\nCase UUID: {case_id}")

        sf_count = await conn.fetchval("SELECT count(*) FROM source_files WHERE case_id = $1::uuid", case_id)
        print(f"Source files in case: {sf_count}")

        ent_count = await conn.fetchval("SELECT count(*) FROM entities WHERE case_id = $1::uuid", case_id)
        print(f"Entities in case: {ent_count}")

        ents = await conn.fetch("SELECT type, canonical_name FROM entities WHERE case_id = $1::uuid ORDER BY type, canonical_name", case_id)
        for e in ents:
            print(f"  [{e['type']}] {e['canonical_name']}")

        id_count = await conn.fetchval("""
            SELECT count(*) FROM identifiers i
            JOIN entities e ON e.id = i.entity_id
            WHERE e.case_id = $1::uuid
        """, case_id)
        print(f"Identifiers in case: {id_count}")

        rel_count = await conn.fetchval("SELECT count(*) FROM relationships WHERE case_id = $1::uuid", case_id)
        print(f"Relationships in case: {rel_count}")

        ev_count = await conn.fetchval("""
            SELECT count(*) FROM evidence ev
            JOIN source_files sf ON sf.id = ev.source_file_id
            WHERE sf.case_id = $1::uuid
        """, case_id)
        print(f"Evidence items in case: {ev_count}")

        audit = await conn.fetchval("SELECT count(*) FROM audit_log WHERE action = 'file.committed'")
        print(f"Audit log entries (file.committed): {audit}")

if __name__ == "__main__":
    asyncio.run(test_e2e())
