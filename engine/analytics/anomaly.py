import numpy as np
import asyncpg


async def anomaly_scan(pg_dsn: str, case_id: str) -> list:
    anomalies = []
    conn = await asyncpg.connect(pg_dsn)

    rows = await conn.fetch(
        "SELECT caller_msisdn, callee_msisdn, start_ts FROM cdr_records WHERE case_id = $1",
        case_id,
    )
    pairs = {}
    for r in rows:
        key = (r["caller_msisdn"], r["callee_msisdn"])
        pairs.setdefault(key, []).append(r["start_ts"])

    for (a, b), ts in pairs.items():
        if len(ts) < 30:
            continue
        recent = [t for t in ts if (ts[-1] - t).days <= 1]
        baseline = len(ts) / 30.0
        if baseline and (len(recent) - baseline) / baseline > 3.0:
            anomalies.append({"kind": "comm_spike", "severity": 4, "entity_ids": [a, b], "score": len(recent)})

    loc = await conn.fetch(
        "SELECT entity_id, lat, lon FROM location_history WHERE origin='cdr'"
    )
    pts = np.array([[r["lat"], r["lon"]] for r in loc])
    if len(pts) >= 3:
        labels = DBSCAN(eps=250 / 111000, min_samples=3).fit_predict(pts)
        for c in set(labels):
            if c == -1:
                continue
            if (labels == c).sum() >= 3:
                anomalies.append({"kind": "geo_convergence", "severity": 3, "entity_ids": [], "score": float((labels == c).sum())})

    await conn.close()
    return anomalies


async def routine(pg_dsn: str, entity_id: str, frm, to) -> dict:
    conn = await asyncpg.connect(pg_dsn)
    pts = await conn.fetch(
        "SELECT lat, lon, ts FROM location_history WHERE entity_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts",
        entity_id, frm, to,
    )
    await conn.close()
    return {"hotspots": [], "loop": [], "dwell_minutes": 0, "points": [dict(p) for p in pts]}
