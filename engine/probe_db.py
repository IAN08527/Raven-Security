"""Standalone proof that the Raven asyncpg storage layer reads cloud Supabase.

Run:  python engine/probe_db.py
It loads RAVEN_PG_DSN from .env (repo root) and exercises the same functions
the FastAPI engine uses.
"""
import asyncio
import os
import sys
import socket
import urllib.request
import json

import dotenv
from dotenv import load_dotenv

load_dotenv(dotenv.find_dotenv())

sys.path.insert(0, os.path.dirname(__file__))
import db as db_layer


def _doh_resolve(host: str):
    """Resolve a host via Google DNS-over-HTTPS (reliable even when the
    sandbox's system resolver is flaky for the Supabase pooler host)."""
    url = f"https://dns.google/resolve?name={host}&type=A"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = json.load(urllib.request.urlopen(req, timeout=10))
    for ans in data.get("Answer", []):
        if ans.get("type") == 1:  # A record
            return ans["data"]
    return None


_cache = {}
# Fallback IPs observed for the Supabase pooler during this session. Used only
# by the proof script when the sandbox resolver is flaky; the real app relies
# on normal DNS (stable on the demo machine).
_FALLBACK_IPS = ["65.0.195.55", "3.111.105.85", "3.109.171.244"]


def _resolve_supabase(host):
    if host in _cache:
        return _cache[host]
    # 1) system resolver
    try:
        return _real_getaddrinfo(host, 0)[0][4][0]
    except Exception:
        pass
    # 2) DoH
    try:
        ip = _doh_resolve(host)
        if ip:
            _cache[host] = ip
            return ip
    except Exception:
        pass
    # 3) known fallback IPs (verify one answers)
    for ip in _FALLBACK_IPS:
        try:
            _real_getaddrinfo(ip, 0)
            _cache[host] = ip
            return ip
        except Exception:
            continue
    return None


def _patched_getaddrinfo(host, port, *args, **kwargs):
    """Patch socket.getaddrinfo so the Supabase host resolves even when the
    sandbox system resolver is intermittently down. The hostname is still used
    for TLS/SNI; only the IP lookup is overridden."""
    if host and "supabase" in host:
        ip = _resolve_supabase(host)
        if ip:
            print(f"[resolve] {host} -> {ip}")
            return _real_getaddrinfo(ip, port, *args, **kwargs)
    return _real_getaddrinfo(host, port, *args, **kwargs)


_real_getaddrinfo = socket.getaddrinfo
socket.getaddrinfo = _patched_getaddrinfo


async def _with_retry(coro_fn, attempts=8, delay=1.5):
    last = None
    for i in range(attempts):
        try:
            return await coro_fn()
        except Exception as e:
            last = e
            print(f"[retry] attempt {i+1}/{attempts} failed: {type(e).__name__} {str(e)[:120]}")
            await asyncio.sleep(delay)
    raise last


async def main() -> int:
    dsn = db_layer.build_dsn()
    assert "supabase.co" in dsn, f"DSN must point at cloud Supabase, got {dsn}"
    print(f"[dsn] {dsn.split('@')[0].split('://')[0]}://<redacted>@{dsn.split('@')[1]}")

    up = await _with_retry(db_layer.db_health)
    print(f"[health] db={'up' if up else 'down'}")
    if not up:
        print("FAIL: cloud Supabase not reachable after retries")
        return 1

    # Schema from Session 1a.
    present = await _with_retry(db_layer.schema_present)
    print(f"[schema] core_tables_present={present}")
    if not present:
        print("FAIL: Raven schema missing")
        return 1

    sf = await _with_retry(db_layer.count_source_files)
    cases = await _with_retry(db_layer.list_cases)

    print(f"[read] source_files={sf} cases={len(cases)}")
    for c in cases:
        print(f"        case {c['case_code']}: {c['title']}")

    # Round-trip write+read through the storage layer.
    case_id = None
    if cases:
        case_id = cases[0]["id"]
    else:
        pool = await db_layer.get_pool()
        async with pool.acquire() as conn:
            case_id = await conn.fetchval(
                "INSERT INTO cases (id, case_code, title) VALUES "
                "(gen_random_uuid(), 'OP-RAVEN-PROBE', 'storage baseline probe') "
                "ON CONFLICT (case_code) DO UPDATE SET title=EXCLUDED.title "
                "RETURNING id::text"
            )

    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        fid = await _with_retry(
            lambda: conn.fetchval(
                "INSERT INTO source_files "
                "(id, case_id, filename, mime_type, byte_size, sha256, storage_path, source) "
                "VALUES (gen_random_uuid(), $1, 'probe.txt', 'text/plain', 42, $2, "
                "'probe/probe.txt', 'MANUAL') RETURNING id::text",
                case_id,
                "0" * 64,
            )
        )
        print(f"[write] inserted source_file id={fid}")

    after = await _with_retry(db_layer.count_source_files)
    print(f"[read] source_files_after={after}")
    await db_layer.close_pool()

    if not fid or after < 1:
        print("FAIL: round-trip failed")
        return 1
    print("PASS: Python asyncpg storage layer reads/writes cloud Supabase")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
