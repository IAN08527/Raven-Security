"""RLS test suite (M0-T4, NFR-8).

Connects straight to the local Postgres instance with psycopg3 and simulates
what PostgREST/GoTrue would do for an authenticated request -- SET ROLE
authenticated, then set the request.jwt.claims GUC that auth.uid() and the
policies' has_case_access()/current_role_is() helpers read -- rather than
going through the Auth or PostgREST HTTP layers. Only the SQL policies
themselves are under test here.

This suite blocks release forever (NFR-8): it is written before there is
anything to protect, not after.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import psycopg
import pytest

DSN = os.environ.get(
    "SUPABASE_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

ZERO_VECTOR_512 = "(SELECT array_agg(0)::vector FROM generate_series(1, 512))"


def as_user(conn: psycopg.Connection[Any], user_id: object, role: str = "authenticated") -> None:
    """Make this connection behave as `user_id` would through PostgREST.

    `user_id` is whatever psycopg3 returned from a uuid column (a UUID
    object, not a str), so it is coerced explicitly for json.dumps."""
    claims = json.dumps({"sub": str(user_id), "role": role}) if user_id else "{}"
    conn.execute(f"SET ROLE {role}")
    conn.execute("SELECT set_config('request.jwt.claims', %s, false)", (claims,))


def as_admin(conn: psycopg.Connection[Any]) -> None:
    conn.execute("RESET ROLE")
    conn.execute("SELECT set_config('request.jwt.claims', '{}', false)")


def count_visible(conn: psycopg.Connection[Any], table: str, id_column: str, row_id: object) -> int:
    cur = conn.execute(f"SELECT 1 FROM {table} WHERE {id_column} = %s", (row_id,))
    return len(cur.fetchall())


@dataclass(frozen=True)
class CaseFixture:
    case_id: str
    source_file_id: str
    entity_id_1: str
    entity_id_2: str
    relationship_id: str
    evidence_id: int
    cdr_id: int
    txn_id: int
    location_id: int
    reid_target_id: str
    reid_candidate_id: int
    ingest_job_id: int
    review_item_id: int
    alias_id: int
    identifier_id: int
    merge_id: int
    audit_id: int


# (table, id_column) for every table whose RLS policy scopes rows to a case,
# directly or through a parent join. Reference tables (cameras, camera_edges,
# engine_nodes, form_templates, weight_params) are deliberately readable by
# any authenticated user (D21) and are excluded: they carry no case content.
CASE_SCOPED_TABLES: list[tuple[str, str]] = [
    ("source_files", "id"),
    ("ingest_jobs", "id"),
    ("review_items", "id"),
    ("entities", "id"),
    ("entity_aliases", "id"),
    ("identifiers", "id"),
    ("entity_merges", "id"),
    ("relationships", "id"),
    ("evidence", "id"),
    ("cdr_records", "id"),
    ("financial_txns", "id"),
    ("location_history", "id"),
    ("reid_targets", "id"),
    ("reid_candidates", "id"),
    ("audit_log", "id"),
]

# NFR-8 / M0-T4: admin manages the system without reading case content (D21).
ADMIN_DENIED_TABLES = [
    "source_files",
    "entities",
    "relationships",
    "evidence",
    "cdr_records",
    "financial_txns",
    "reid_targets",
    "reid_candidates",
]


def fixture_field(fixture: CaseFixture, table: str) -> object:
    return {
        "source_files": fixture.source_file_id,
        "ingest_jobs": fixture.ingest_job_id,
        "review_items": fixture.review_item_id,
        "entities": fixture.entity_id_1,
        "entity_aliases": fixture.alias_id,
        "identifiers": fixture.identifier_id,
        "entity_merges": fixture.merge_id,
        "relationships": fixture.relationship_id,
        "evidence": fixture.evidence_id,
        "cdr_records": fixture.cdr_id,
        "financial_txns": fixture.txn_id,
        "location_history": fixture.location_id,
        "reid_targets": fixture.reid_target_id,
        "reid_candidates": fixture.reid_candidate_id,
        "audit_log": fixture.audit_id,
    }[table]


def seed_case(conn: psycopg.Connection[Any], case_code: str, officer_id: str, camera_id: str) -> CaseFixture:
    """Insert one row into every case-scoped table for a fresh case. Runs as
    the table owner (postgres), which bypasses RLS -- the baseline does not
    set FORCE ROW LEVEL SECURITY."""
    case_id = conn.execute(
        "INSERT INTO cases (case_code, title, lead_officer) VALUES (%s, %s, %s) RETURNING id",
        (case_code, f"{case_code} title", officer_id),
    ).fetchone()[0]

    source_file_id = conn.execute(
        """INSERT INTO source_files
             (case_id, filename, mime_type, byte_size, sha256, storage_path,
              source, provenance, uploaded_by)
           VALUES (%s, 'evidence.pdf', 'application/pdf', 100,
                   repeat('a', 64), '/blobs/a', 'MANUAL', 'collected', %s)
           RETURNING id""",
        (case_id, officer_id),
    ).fetchone()[0]

    ingest_job_id = conn.execute(
        """INSERT INTO ingest_jobs (file_id, stage, status)
           VALUES (%s, 'extraction', 'ok') RETURNING id""",
        (source_file_id,),
    ).fetchone()[0]

    review_item_id = conn.execute(
        """INSERT INTO review_items (source_file_id, script, crop_path, status)
           VALUES (%s, 'Latn', '/crops/a.png', 'pending') RETURNING id""",
        (source_file_id,),
    ).fetchone()[0]

    entity_id_1 = conn.execute(
        """INSERT INTO entities (case_id, type, canonical_name, provenance)
           VALUES (%s, 'PERSON', %s, 'collected') RETURNING id""",
        (case_id, f"{case_code} suspect"),
    ).fetchone()[0]

    entity_id_2 = conn.execute(
        """INSERT INTO entities (case_id, type, canonical_name, provenance)
           VALUES (%s, 'PERSON', %s, 'collected') RETURNING id""",
        (case_id, f"{case_code} associate"),
    ).fetchone()[0]

    alias_id = conn.execute(
        """INSERT INTO entity_aliases (entity_id, alias, normalized, source_file_id)
           VALUES (%s, 'alias', 'alias', %s) RETURNING id""",
        (entity_id_1, source_file_id),
    ).fetchone()[0]

    identifier_id = conn.execute(
        """INSERT INTO identifiers (entity_id, type, value, source_file_id, provenance)
           VALUES (%s, 'PHONE', %s, %s, 'collected') RETURNING id""",
        (entity_id_1, f"+91{case_code}", source_file_id),
    ).fetchone()[0]

    merge_id = conn.execute(
        """INSERT INTO entity_merges
             (surviving_id, merged_id, reason, reversible_snapshot)
           VALUES (%s, gen_random_uuid(), 'manual', '{}'::jsonb) RETURNING id""",
        (entity_id_1,),
    ).fetchone()[0]

    relationship_id = conn.execute(
        """INSERT INTO relationships
             (case_id, src_entity_id, dst_entity_id, type, provenance)
           VALUES (%s, %s, %s, 'CO_ACCUSED', 'collected') RETURNING id""",
        (case_id, entity_id_1, entity_id_2),
    ).fetchone()[0]

    evidence_id = conn.execute(
        # Dummy span (0, 4): this seed tests row visibility, not span
        # correctness. Required by the M4-T2 evidence_fir_text_has_span
        # CHECK (fir_text rows must carry a span); other kinds need none.
        """INSERT INTO evidence
             (relationship_id, source_file_id, kind, char_start, char_end, provenance)
           VALUES (%s, %s, 'fir_text', 0, 4, 'collected') RETURNING id""",
        (relationship_id, source_file_id),
    ).fetchone()[0]

    # D16, CLAUDE.md rule 3: case data never derives from now(). A fixed
    # case-clock timestamp keeps a replay of this fixture deterministic.
    case_clock_ts = "2025-06-01T12:00:00Z"

    cdr_id = conn.execute(
        """INSERT INTO cdr_records
             (case_id, caller_msisdn, callee_msisdn, start_ts, duration_s, provenance)
           VALUES (%s, '1000000000', '2000000000', %s, 60, 'collected')
           RETURNING id""",
        (case_id, case_clock_ts),
    ).fetchone()[0]

    txn_id = conn.execute(
        """INSERT INTO financial_txns
             (case_id, from_account, to_account, amount, ts, provenance)
           VALUES (%s, 'AC1', 'AC2', 100.00, %s, 'collected') RETURNING id""",
        (case_id, case_clock_ts),
    ).fetchone()[0]

    location_id = conn.execute(
        """INSERT INTO location_history
             (entity_id, ts, lat, lon, origin, provenance)
           VALUES (%s, %s, 0, 0, 'address', 'collected') RETURNING id""",
        (entity_id_1, case_clock_ts),
    ).fetchone()[0]

    reid_target_id = conn.execute(
        f"""INSERT INTO reid_targets
              (case_id, label, embedding, source_camera, source_ts, locked_by)
            VALUES (%s, 'target', {ZERO_VECTOR_512}, %s, %s, %s)
            RETURNING id""",
        (case_id, camera_id, case_clock_ts, officer_id),
    ).fetchone()[0]

    reid_candidate_id = conn.execute(
        """INSERT INTO reid_candidates
             (target_id, camera_id, ts, similarity, threshold_used, bbox)
           VALUES (%s, %s, %s, 0.9, 0.8, ARRAY[0, 0, 10, 10])
           RETURNING id""",
        (reid_target_id, camera_id, case_clock_ts),
    ).fetchone()[0]

    audit_id = conn.execute(
        """INSERT INTO audit_log (user_id, case_id, action, payload_hash)
           VALUES (%s, %s, 'file.read', repeat('b', 64)) RETURNING id""",
        (officer_id, case_id),
    ).fetchone()[0]

    return CaseFixture(
        case_id=case_id,
        source_file_id=source_file_id,
        entity_id_1=entity_id_1,
        entity_id_2=entity_id_2,
        relationship_id=relationship_id,
        evidence_id=evidence_id,
        cdr_id=cdr_id,
        txn_id=txn_id,
        location_id=location_id,
        reid_target_id=reid_target_id,
        reid_candidate_id=reid_candidate_id,
        ingest_job_id=ingest_job_id,
        review_item_id=review_item_id,
        alias_id=alias_id,
        identifier_id=identifier_id,
        merge_id=merge_id,
        audit_id=audit_id,
    )


@dataclass(frozen=True)
class World:
    officer_a: str
    officer_b: str
    admin: str
    camera_id: str
    alpha: CaseFixture
    beta: CaseFixture
    insight_relationship_id: int
    insight_entity_id: int
    insight_candidate_id: int
    insight_merge_id: int


def make_user(conn: psycopg.Connection[Any], email: str, badge_no: str, role: str) -> str:
    user_id = conn.execute(
        """INSERT INTO auth.users
             (instance_id, id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at,
              raw_app_meta_data, raw_user_meta_data)
           VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
                   'authenticated', 'authenticated', %s,
                   crypt('password', gen_salt('bf')), now(), now(), now(),
                   '{}'::jsonb, '{}'::jsonb)
           RETURNING id""",
        (email,),
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO profiles (id, badge_no, full_name, role)
           VALUES (%s, %s, %s, %s)""",
        (user_id, badge_no, badge_no, role),
    )
    return user_id


@pytest.fixture(scope="module")
def world() -> Iterator[World]:
    with psycopg.connect(DSN, autocommit=True) as conn:
        officer_a = make_user(conn, "officer_a@raven.test", "A-001", "io")
        officer_b = make_user(conn, "officer_b@raven.test", "B-001", "io")
        admin = make_user(conn, "admin@raven.test", "ADM-001", "admin")

        camera_id = conn.execute(
            """INSERT INTO cameras
                 (code, label, lat, lon, feed_uri, mode, declared_start_ts, fps)
               VALUES ('CAM-1', 'Test camera', 0, 0, 'file:///none.mp4',
                       'recorded', '2025-01-01T00:00:00Z', 10)
               RETURNING id"""
        ).fetchone()[0]

        alpha = seed_case(conn, "case_alpha", officer_a, camera_id)
        beta = seed_case(conn, "case_beta", officer_b, camera_id)

        conn.execute(
            "INSERT INTO case_assignments (case_id, user_id, assigned_role) VALUES (%s, %s, 'io')",
            (alpha.case_id, officer_a),
        )
        conn.execute(
            "INSERT INTO case_assignments (case_id, user_id, assigned_role) VALUES (%s, %s, 'io')",
            (beta.case_id, officer_b),
        )

        # insight_reviews: 'relationship' and 'entity' object_ids type-match
        # their parent tables (both uuid) and are gated correctly by D28.
        # 'candidate' and 'merge' cannot be: reid_candidates.id and
        # entity_merges.id are bigserial, not uuid, so object_id can never
        # equal a real row's key. Those two are seeded with a random uuid
        # that matches nothing, to prove the fail-closed branch denies
        # everyone rather than passing by accident.
        insight_relationship_id = conn.execute(
            """INSERT INTO insight_reviews (object_type, object_id, action, user_id)
               VALUES ('relationship', %s, 'confirm', %s) RETURNING id""",
            (alpha.relationship_id, officer_a),
        ).fetchone()[0]
        insight_entity_id = conn.execute(
            """INSERT INTO insight_reviews (object_type, object_id, action, user_id)
               VALUES ('entity', %s, 'confirm', %s) RETURNING id""",
            (beta.entity_id_1, officer_b),
        ).fetchone()[0]
        insight_candidate_id = conn.execute(
            """INSERT INTO insight_reviews (object_type, object_id, action, user_id)
               VALUES ('candidate', gen_random_uuid(), 'confirm', %s) RETURNING id""",
            (officer_a,),
        ).fetchone()[0]
        insight_merge_id = conn.execute(
            """INSERT INTO insight_reviews (object_type, object_id, action, user_id)
               VALUES ('merge', gen_random_uuid(), 'confirm', %s) RETURNING id""",
            (officer_b,),
        ).fetchone()[0]

        yield World(
            officer_a=officer_a,
            officer_b=officer_b,
            admin=admin,
            camera_id=camera_id,
            alpha=alpha,
            beta=beta,
            insight_relationship_id=insight_relationship_id,
            insight_entity_id=insight_entity_id,
            insight_candidate_id=insight_candidate_id,
            insight_merge_id=insight_merge_id,
        )

        # Deletion order matters here in a way `supabase db reset` never
        # exercises: audit_log.case_id, entity_aliases.source_file_id and
        # identifiers.source_file_id all reference their parent with no
        # ON DELETE action (unlike every entity_id/case_id FK, which
        # cascades), so a plain `DELETE FROM cases` fails with a foreign key
        # violation. That asymmetry is a real schema gap worth a follow-up
        # migration, not fixed here (out of scope for M0-T4). Delete
        # leaf-to-root by the ids this fixture already captured instead.
        for fixture in (alpha, beta):
            conn.execute(
                "DELETE FROM insight_reviews WHERE user_id IN (%s, %s)",
                (officer_a, officer_b),
            )
            conn.execute("DELETE FROM entity_aliases WHERE id = %s", (fixture.alias_id,))
            conn.execute("DELETE FROM identifiers WHERE id = %s", (fixture.identifier_id,))
            conn.execute("DELETE FROM entity_merges WHERE id = %s", (fixture.merge_id,))
            conn.execute("DELETE FROM evidence WHERE id = %s", (fixture.evidence_id,))
            conn.execute("DELETE FROM review_items WHERE id = %s", (fixture.review_item_id,))
            conn.execute("DELETE FROM ingest_jobs WHERE id = %s", (fixture.ingest_job_id,))
            conn.execute(
                "DELETE FROM reid_candidates WHERE id = %s", (fixture.reid_candidate_id,)
            )
            conn.execute("DELETE FROM location_history WHERE id = %s", (fixture.location_id,))
            conn.execute("DELETE FROM audit_log WHERE id = %s", (fixture.audit_id,))
            conn.execute("DELETE FROM relationships WHERE id = %s", (fixture.relationship_id,))
            conn.execute("DELETE FROM reid_targets WHERE id = %s", (fixture.reid_target_id,))
            conn.execute("DELETE FROM cdr_records WHERE id = %s", (fixture.cdr_id,))
            conn.execute("DELETE FROM financial_txns WHERE id = %s", (fixture.txn_id,))
            conn.execute(
                "DELETE FROM entities WHERE id IN (%s, %s)",
                (fixture.entity_id_1, fixture.entity_id_2),
            )
            conn.execute("DELETE FROM source_files WHERE id = %s", (fixture.source_file_id,))

        conn.execute(
            "DELETE FROM case_assignments WHERE case_id IN (%s, %s)",
            (alpha.case_id, beta.case_id),
        )
        conn.execute("DELETE FROM cases WHERE id IN (%s, %s)", (alpha.case_id, beta.case_id))
        conn.execute("DELETE FROM cameras WHERE id = %s", (camera_id,))
        conn.execute(
            "DELETE FROM auth.users WHERE id IN (%s, %s, %s)", (officer_a, officer_b, admin)
        )


@pytest.fixture()
def conn() -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(DSN, autocommit=True) as connection:
        yield connection
        as_admin(connection)


@pytest.mark.parametrize("table,id_column", CASE_SCOPED_TABLES)
def test_officer_a_cannot_read_case_beta(
    conn: psycopg.Connection[Any], world: World, table: str, id_column: str
) -> None:
    other_row_id = fixture_field(world.beta, table)
    as_user(conn, world.officer_a)
    assert count_visible(conn, table, id_column, other_row_id) == 0


@pytest.mark.parametrize("table,id_column", CASE_SCOPED_TABLES)
def test_officer_b_cannot_read_case_alpha(
    conn: psycopg.Connection[Any], world: World, table: str, id_column: str
) -> None:
    other_row_id = fixture_field(world.alpha, table)
    as_user(conn, world.officer_b)
    assert count_visible(conn, table, id_column, other_row_id) == 0


@pytest.mark.parametrize("table,id_column", CASE_SCOPED_TABLES)
def test_officer_a_can_read_own_case(
    conn: psycopg.Connection[Any], world: World, table: str, id_column: str
) -> None:
    own_row_id = fixture_field(world.alpha, table)
    as_user(conn, world.officer_a)
    assert count_visible(conn, table, id_column, own_row_id) == 1


@pytest.mark.parametrize("table,id_column", CASE_SCOPED_TABLES)
def test_officer_b_can_read_own_case(
    conn: psycopg.Connection[Any], world: World, table: str, id_column: str
) -> None:
    own_row_id = fixture_field(world.beta, table)
    as_user(conn, world.officer_b)
    assert count_visible(conn, table, id_column, own_row_id) == 1


def test_admin_reads_all_profiles(conn: psycopg.Connection[Any], world: World) -> None:
    as_user(conn, world.admin)
    rows = conn.execute(
        "SELECT id FROM profiles WHERE id IN (%s, %s)", (world.officer_a, world.officer_b)
    ).fetchall()
    assert len(rows) == 2


def test_admin_reads_all_assignments(conn: psycopg.Connection[Any], world: World) -> None:
    as_user(conn, world.admin)
    rows = conn.execute(
        "SELECT case_id FROM case_assignments WHERE case_id IN (%s, %s)",
        (world.alpha.case_id, world.beta.case_id),
    ).fetchall()
    assert len(rows) == 2


@pytest.mark.parametrize("table", ADMIN_DENIED_TABLES)
def test_admin_reads_no_case_content(conn: psycopg.Connection[Any], world: World, table: str) -> None:
    as_user(conn, world.admin)
    count = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    assert count == 0


def test_unassigned_admin_is_the_no_assignment_case(conn: psycopg.Connection[Any], world: World) -> None:
    """The admin fixture has no case_assignments row, which is exactly the
    'user with no assignment reads nothing' case from BUILD_PLAN.md M0-T4."""
    as_user(conn, world.admin)
    count = conn.execute(
        "SELECT count(*) FROM case_assignments WHERE user_id = %s", (world.admin,)
    ).fetchone()[0]
    assert count == 0


def test_insight_reviews_own_case_visible(conn: psycopg.Connection[Any], world: World) -> None:
    as_user(conn, world.officer_a)
    assert count_visible(conn, "insight_reviews", "id", world.insight_relationship_id) == 1

    as_user(conn, world.officer_b)
    assert count_visible(conn, "insight_reviews", "id", world.insight_entity_id) == 1


def test_insight_reviews_cross_case_denied(conn: psycopg.Connection[Any], world: World) -> None:
    as_user(conn, world.officer_a)
    assert count_visible(conn, "insight_reviews", "id", world.insight_entity_id) == 0

    as_user(conn, world.officer_b)
    assert count_visible(conn, "insight_reviews", "id", world.insight_relationship_id) == 0


@pytest.mark.parametrize("who", ["officer_a", "officer_b", "admin"])
def test_insight_reviews_unresolvable_object_types_fail_closed(
    conn: psycopg.Connection[Any], world: World, who: str
) -> None:
    """D28: 'candidate' and 'merge' object_ids cannot be matched to a real
    row (uuid vs. the parent tables' bigserial keys), so the policy must
    deny them for everyone rather than resolve nothing and pass."""
    as_user(conn, getattr(world, who))
    assert count_visible(conn, "insight_reviews", "id", world.insight_candidate_id) == 0
    assert count_visible(conn, "insight_reviews", "id", world.insight_merge_id) == 0


@pytest.mark.parametrize("table", ["cameras", "camera_edges", "engine_nodes", "form_templates", "weight_params"])
def test_reference_tables_readable_by_any_authenticated_user(
    conn: psycopg.Connection[Any], world: World, table: str
) -> None:
    """These carry no case content and are deliberately global (D21)."""
    as_user(conn, world.officer_a)
    conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
