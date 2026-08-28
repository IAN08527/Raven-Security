import asyncpg


async def predict_handoff(pg_dsn: str, from_camera: str) -> list:
    conn = await asyncpg.connect(pg_dsn)
    rows = await conn.fetch(
        """SELECT n.code, e.mean_travel_s, e.stddev_s
           FROM cameras n
           JOIN camera_edges e ON e.from_camera = n.id
           WHERE n.code = $1""",
        from_camera,
    )
    await conn.close()
    return [dict(r) for r in rows]
