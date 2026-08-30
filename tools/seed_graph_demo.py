"""Seed a rich synthetic criminal network for graph-engine testing (Backlog #4).

Run:  python tools/seed_graph_demo.py [case_code]

Idempotent: entity/relation ids are UUID5-derived with the SAME namespace and
key scheme as engine/nlp/ids.py, so re-running (or re-ingesting a document
that mentions the same names) collapses onto the same rows. Weights are
re-derived with the schema's recompute_weight() (§7.1) for every relationship
in the case, so edge weights always follow the evidence.

The network mirrors the golden path (tools/seed_golden_path.py):
  * Rakesh Sawant kingpin + syndicate B (CO_ACCUSED via FIR text)
  * CDR call spike syndicate A <-> B (CALLED, cdr_row evidence)
  * Structuring 6x Rs 49,500 into the cousin mule account (TRANSFERRED_TO, txn_row)
  * CCTV sightings across cam_01 -> cam_02 (SEEN_WITH / CO_LOCATED, cctv_sighting)
"""
import asyncio
import os
import sys
import uuid

import dotenv

dotenv.load_dotenv(dotenv.find_dotenv())
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
print("[seed] imports pre-db", flush=True)
import db as db_layer  # noqa: E402

# Import probe_db ONLY for its DNS DoH patch (sandbox resolver flakiness).
import probe_db  # noqa: F401,E402
print("[seed] imports done", flush=True)

NS = "f0e1d2c3-4567-89ab-cdef-0123456789ab"


def eid(etype: str, name: str) -> str:
    import uuid

    return str(uuid.uuid5(uuid.UUID(NS), f"E|{etype.strip().upper()}|{name.strip().lower()}"))


def rid(src: str, dst: str, rtype: str) -> str:
    return str(uuid.uuid5(uuid.UUID(NS), f"R|{src}|{dst}|{rtype.strip().upper()}"))


PERSONS = [
    ("Rakesh Sawant", 0.92),
    ("Suresh Patil", 0.71),
    ("Vijay Deshmukh", 0.66),
    ("Sanjay Jadhav", 0.58),
    ("Deepak Gaikwad", 0.58),
    ("Arjun Kamble", 0.44),
    ("Rahul More", 0.39),
]
ORGS = ["M/s QuickPay Solutions Pvt Ltd", "Skyline Cargo LLP", "Sai Enterprises"]
VEHICLES = ["MH01AB1234", "MH12XY9988", "MH03CD4567"]
ACCOUNTS = ["HDFC 501001234567", "ICICI 00245678901", "SBI 37890123456"]
LOCATIONS = ["Dadar East", "Sakinaka Junction", "Andheri East", "Kurla Depot"]

# (src, dst, rtype, [(kind, snippet), ...])
RELATIONS = [
    ("Rakesh Sawant", "Suresh Patil", "CO_ACCUSED",
     [("fir_text", "FIR names Rakesh Sawant and Suresh Patil as co-accused in the extortion case")]),
    ("Rakesh Sawant", "Vijay Deshmukh", "CO_ACCUSED",
     [("fir_text", "Charge-sheet lists Vijay Deshmukh alongside Rakesh Sawant for conspiracy")]),
    ("Suresh Patil", "Sanjay Jadhav", "CO_ACCUSED",
     [("fir_text", "Suresh Patil acted with Sanjay Jadhav during the extortion attempt")]),
    ("Rakesh Sawant", "Suresh Patil", "CALLED",
     [("cdr_row", "17 calls between 98200XXXXX and 98201XXXXX in the 36h before the incident")]),
    ("Suresh Patil", "Vijay Deshmukh", "CALLED",
     [("cdr_row", "9 calls between Suresh Patil and Vijay Deshmukh on incident week")]),
    ("Vijay Deshmukh", "Rahul More", "CALLED",
     [("cdr_row", "6 calls between Vijay Deshmukh and Rahul More, avg 240s")]),
    ("Deepak Gaikwad", "Rakesh Sawant", "CALLED",
     [("cdr_row", "12 short calls from Deepak Gaikwad to Rakesh Sawant, late night hours")]),
    ("ICICI 00245678901", "SBI 37890123456", "TRANSFERRED_TO",
     [("txn_row", "6x Rs 49,500 structuring transfers from ICICI 00245678901 to SBI 37890123456")]),
    ("ICICI 00245678901", "HDFC 501001234567", "TRANSFERRED_TO",
     [("txn_row", "Rs 2,40,000 consolidated transfer to HDFC 501001234567")]),
    ("Rakesh Sawant", "Deepak Gaikwad", "SEEN_WITH",
     [("cctv_sighting", "cam_01 21:42 two males together, one matching Rakesh Sawant")]),
    ("Suresh Patil", "MH01AB1234", "SEEN_WITH",
     [("cctv_sighting", "cam_02 Suresh Patil entering MH01AB1234 at 22:05")]),
    ("Vijay Deshmukh", "MH12XY9988", "SEEN_WITH",
     [("cctv_sighting", "cam_04 Vijay Deshmukh near MH12XY9988 at 23:10")]),
    ("Rakesh Sawant", "M/s QuickPay Solutions Pvt Ltd", "CO_LOCATED",
     [("cdr_row", "Rakesh handset pinged on cell adjacent to QuickPay office for 3h")]),
    ("Deepak Gaikwad", "Rakesh Sawant", "RESIDES_WITH",
     [("fir_text", "Deepak Gaikwad (kingpin's cousin) shares the Sakinaka address with Rakesh Sawant")]),
    ("Rahul More", "Sakinaka Junction", "CO_LOCATED",
     [("cdr_row", "Rahul More CDR pings cluster around Sakinaka Junction 21:00-23:00")]),
    ("Vijay Deshmukh", "Suresh Patil", "CO_LOCATED",
     [("cctv_sighting", "cam_04 both together at toll booth 21:58")]),
    ("Rakesh Sawant", "MH01AB1234", "SEEN_WITH",
     [("cctv_sighting", "cam_01 Rakesh Sawant boarding MH01AB1234")]),
    ("Deepak Gaikwad", "ICICI 00245678901", "CO_LOCATED",
     [("txn_row", "ATM withdrawals from ICICI 00245678901 within 1km of Deepak's pings")]),
    ("Rahul More", "Vijay Deshmukh", "SEEN_WITH",
     [("cctv_sighting", "cam_03 two males matching Rahul More and Vijay Deshmukh")]),
    ("Suresh Patil", "Dadar East", "CO_LOCATED",
     [("cdr_row", "Suresh Patil pings concentrated in Dadar East during collection window")]),
]

IDENTIFIERS = [
    ("Rakesh Sawant", "PHONE", "+91-98200-11223"),
    ("Rakesh Sawant", "NAFIS", "NAFIS-0001"),
    ("Suresh Patil", "PHONE", "+91-98201-44556"),
    ("Vijay Deshmukh", "PHONE", "+91-99300-77889"),
    ("Deepak Gaikwad", "PHONE", "+91-99670-11223"),
    ("MH01AB1234", "VEHICLE", "MH01AB1234"),
    ("MH12XY9988", "VEHICLE", "MH12XY9988"),
    ("ICICI 00245678901", "ACCOUNT", "00245678901"),
    ("SBI 37890123456", "ACCOUNT", "37890123456"),
]

ALIASES = [
    ("Rakesh Sawant", "R. Sawant"),
    ("Deepak Gaikwad", "Deepak (cousin)"),
    ("M/s QuickPay Solutions Pvt Ltd", "QuickPay"),
]


async def main() -> int:
    case_code = sys.argv[1] if len(sys.argv) > 1 else "OP-RAVEN-01"
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        case_id = await conn.fetchval(
            "SELECT id::text FROM cases WHERE case_code = $1", case_code
        )
        if not case_id:
            case_id = await conn.fetchval(
                "INSERT INTO cases (id, case_code, title) VALUES "
                "(gen_random_uuid(), $1, 'Synthetic network demo case') RETURNING id::text",
                case_code,
            )
        print(f"case {case_code} -> {case_id}")

        # A committed source_file to anchor evidence rows (reuse if present).
        sf_id = await conn.fetchval(
            "SELECT id::text FROM source_files WHERE case_id = $1::uuid "
            "AND status = 'committed' ORDER BY created_at LIMIT 1",
            case_id,
        )
        if not sf_id:
            sf_id = await conn.fetchval(
                "INSERT INTO source_files (case_id, filename, mime_type, byte_size, "
                "sha256, storage_path, source, status) VALUES "
                "($1, 'seed/demo_network.txt', 'text/plain', 128, $2, 'seed/demo_network.txt', "
                "'MANUAL', 'committed') RETURNING id::text",
                case_id,
                "0" * 64,
            )
        print(f"evidence source_file -> {sf_id}")

        # Idempotent re-runs: drop only the evidence rows this seeder created
        # (keyed by the seeded source_file) so counts stay correct.
        await conn.execute(
            "DELETE FROM evidence WHERE source_file_id = $1::uuid", sf_id
        )

        # --- entities -----------------------------------------------------
        ents: list[tuple[str, str, str]] = []
        for name, risk in PERSONS:
            ents.append((eid("PERSON", name), "PERSON", name))
            await conn.execute(
                "UPDATE entities SET risk_score = $2 WHERE id = $1::uuid",
                eid("PERSON", name), risk,
            )
        for name in ORGS:
            ents.append((eid("ORGANIZATION", name), "ORGANIZATION", name))
        for name in VEHICLES:
            ents.append((eid("VEHICLE", name), "VEHICLE", name))
        for name in ACCOUNTS:
            ents.append((eid("ACCOUNT", name), "ACCOUNT", name))
        for name in LOCATIONS:
            ents.append((eid("LOCATION", name), "LOCATION", name))

        for id_, etype, name in ents:
            await conn.execute(
                "INSERT INTO entities (id, case_id, type, canonical_name, sync_state) "
                "VALUES ($1::uuid, $2::uuid, $3, $4, 'pending') "
                "ON CONFLICT (id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name",
                id_, case_id, etype, name,
            )
        print(f"entities ensured: {len(ents)}")

        # --- identifiers + aliases (only for entities we know) -------------
        by_name = {n: eid(t, n) for _, t, n in ents}
        for name, itype, value in IDENTIFIERS:
            e = by_name.get(name)
            if not e:
                continue
            await conn.execute(
                "INSERT INTO identifiers (entity_id, type, value) "
                "VALUES ($1::uuid, $2::identifier_type, $3) "
                "ON CONFLICT (type, value, entity_id) DO NOTHING",
                e, itype, value,
            )
        for name, alias in ALIASES:
            e = by_name.get(name)
            if not e:
                continue
            await conn.execute(
                "INSERT INTO entity_aliases (entity_id, alias, normalized) "
                "VALUES ($1::uuid, $2, $3) ON CONFLICT (entity_id, normalized) DO NOTHING",
                e, alias, alias.lower(),
            )

        # --- relationships + evidence --------------------------------------
        n_rel = 0
        for src_name, dst_name, rtype, evs in RELATIONS:
            s, d = by_name[src_name], by_name[dst_name]
            rel = rid(s, d, rtype)
            await conn.execute(
                "INSERT INTO relationships (id, case_id, src_entity_id, dst_entity_id, "
                "type, weight, raw_score, evidence_count, sync_state) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::rel_type, 0, 0, 0, 'pending') "
                "ON CONFLICT (src_entity_id, dst_entity_id, type) DO NOTHING",
                rel, case_id, s, d, rtype,
            )
            for kind, snippet in evs:
                await conn.execute(
                    "INSERT INTO evidence (relationship_id, source_file_id, kind, snippet) "
                    "VALUES ($1::uuid, $2::uuid, $3, $4)",
                    rel, sf_id, kind, snippet,
                )
            n_rel += 1
        print(f"relations ensured: {n_rel}")

        # --- recompute §7.1 weights for EVERY relationship in the case -----
        n_w = await conn.fetchval("SELECT count(*) FROM relationships WHERE case_id = $1::uuid", case_id)
        rows = await conn.fetch(
            "SELECT id FROM relationships WHERE case_id = $1::uuid", case_id
        )
        for r in rows:
            await conn.fetchval("SELECT recompute_weight($1::uuid)", r["id"])
        print(f"weights recomputed for {len(rows)} relationships")

        await db_layer.close_pool()
        print("PASS: demo network seeded")
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
