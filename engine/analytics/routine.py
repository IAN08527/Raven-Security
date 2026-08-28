import asyncpg


async def routine(pg_dsn: str, entity_id: str, frm, to) -> dict:
    conn = await asyncpg.connect(pg_dsn)
    pts = await conn.fetch(
        "SELECT lat, lon, ts, origin FROM location_history WHERE entity_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts",
        entity_id, frm, to,
    )
    await conn.close()
    return {"points": [dict(p) for p in pts], "hotspots": [], "loop": [], "dwell_minutes": 0}
