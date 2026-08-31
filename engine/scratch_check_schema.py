import asyncio
import dotenv
dotenv.load_dotenv()
import probe_db
import db as db_layer

async def check_enums():
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        enums = await conn.fetch("""
            SELECT t.typname, e.enumlabel
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
            ORDER BY t.typname, e.enumsortorder
        """)
        grouped = {}
        for r in enums:
            grouped.setdefault(r['typname'], []).append(r['enumlabel'])
        for k, v in grouped.items():
            print(f"{k}: {v}")

if __name__ == "__main__":
    asyncio.run(check_enums())
