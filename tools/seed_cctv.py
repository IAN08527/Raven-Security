"""Seed the CCTV camera network + topology (Backlog #5, Phase 0).

Writes the `cameras` and `camera_edges` rows the CCTV Re-ID module needs:
- 4 cameras (cam_01..cam_04) clustered in one locality, each pointing at a
  local demo clip via `feed_uri` (the .mp4 files are added on the demo machine;
  the paths are seeded now — see assets/cctv/README).
- The physical topology (D8): cam_01 -> cam_02 -> cam_04 is the golden-path
  handoff (tools/seed_golden_path.py), with a cam_03 branch that reconverges
  on cam_04 so "target took the other route" is demoable.

Topology:

    cam_01 ──18s──> cam_02 ──25s──> cam_04
       └────30s────> cam_03 ──22s────┘

Idempotent: safe to re-run (ON CONFLICT upserts). Reuses engine/db.py so it
talks to the same cloud Supabase project as the rest of the stack.

Run:  python tools/seed_cctv.py
"""
import asyncio
import os
import sys

# engine/ holds db.py + the .env loader convention; make it importable and
# load the repo .env the same way engine/main.py does.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import dotenv  # noqa: E402

dotenv.load_dotenv(os.path.join(ROOT, ".env"))

import db as db_layer  # noqa: E402


# code, label, lat, lon, feed_uri  (coords: a single locality cluster)
CAMERAS = [
    ("cam_01", "Junction – Market St",  19.0728, 72.8826, "assets/cctv/cam_01.mp4"),
    ("cam_02", "Overpass – North",      19.0741, 72.8839, "assets/cctv/cam_02.mp4"),
    ("cam_03", "Alley – East Lane",     19.0733, 72.8851, "assets/cctv/cam_03.mp4"),
    ("cam_04", "Transit Hub – Plaza",   19.0755, 72.8860, "assets/cctv/cam_04.mp4"),
]

# from_code, to_code, mean_travel_s, stddev_s, path_label
EDGES = [
    ("cam_01", "cam_02", 18, 4, "main walkway"),
    ("cam_02", "cam_04", 25, 6, "to transit hub"),
    ("cam_01", "cam_03", 30, 8, "east alley detour"),
    ("cam_03", "cam_04", 22, 5, "alley reconverge"),
]


async def seed() -> None:
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for code, label, lat, lon, feed in CAMERAS:
                await conn.execute(
                    """
                    INSERT INTO cameras (code, label, lat, lon, feed_uri, status)
                    VALUES ($1, $2, $3, $4, $5, 'online')
                    ON CONFLICT (code) DO UPDATE SET
                        label = EXCLUDED.label,
                        lat = EXCLUDED.lat,
                        lon = EXCLUDED.lon,
                        feed_uri = EXCLUDED.feed_uri,
                        status = EXCLUDED.status
                    """,
                    code, label, lat, lon, feed,
                )

            for src, dst, mean_s, std_s, plabel in EDGES:
                await conn.execute(
                    """
                    INSERT INTO camera_edges
                        (from_camera, to_camera, mean_travel_s, stddev_s, path_label)
                    SELECT f.id, t.id, $3, $4, $5
                    FROM cameras f, cameras t
                    WHERE f.code = $1 AND t.code = $2
                    ON CONFLICT (from_camera, to_camera) DO UPDATE SET
                        mean_travel_s = EXCLUDED.mean_travel_s,
                        stddev_s = EXCLUDED.stddev_s,
                        path_label = EXCLUDED.path_label
                    """,
                    src, dst, mean_s, std_s, plabel,
                )

        cam_n = await conn.fetchval("SELECT count(*) FROM cameras")
        edge_n = await conn.fetchval("SELECT count(*) FROM camera_edges")
        print(f"seeded cameras={cam_n} camera_edges={edge_n}")
        for code, label, *_ in CAMERAS:
            outs = await conn.fetch(
                """SELECT t.code, e.mean_travel_s, e.stddev_s
                   FROM camera_edges e
                   JOIN cameras f ON e.from_camera = f.id
                   JOIN cameras t ON e.to_camera = t.id
                   WHERE f.code = $1 ORDER BY t.code""",
                code,
            )
            downstream = ", ".join(f"{r['code']}({r['mean_travel_s']}±{r['stddev_s']}s)" for r in outs)
            print(f"  {code}: -> {downstream or '(leaf)'}")


async def main() -> None:
    try:
        if not await db_layer.db_health():
            print("DB health FAILED — check RAVEN_PG_DSN in .env", file=sys.stderr)
            sys.exit(1)
        await seed()
    finally:
        await db_layer.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
