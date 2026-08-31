"""Phase 5 proof: human-in-the-loop confirm + evidence (FR-2.3, §5.3).

Phase 5's core act — confirm/reject a sighting → write `insight_reviews` +
`reid_sightings.confirmed_by`, mint `cctv_sighting` evidence, and bump the linked
edge via `recompute_weight` — lives in Rust (`raven_core::reid::confirm_sighting`)
and SQL. There is no importable Python surface for it, so (like the Phase 2 Rust
side) the live confirm writing the two rows + the weight bump verifies on the
demo machine via `cargo check -p raven -p raven-core` + one live confirm.

What IS provable here, GPU-less and DB-less:

  1. The sighting-frame review route guard (real Python code path) — a bare
     filename resolves, every traversal / separator / absolute path is rejected.
  2. Schema parity by inspecting the actual SQL source the Rust confirm depends
     on — `recompute_weight` scores `cctv_sighting` at 10 (the +10 the "edges
     thicken" claim rests on), and migration 002 makes the evidence + review
     tables accept a sighting (nullable source_file for cctv_sighting only;
     polymorphic object_id widened to text).

Run:  python tools/test_confirm.py
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

from cv.frames import resolve_frame, safe_basename  # noqa: E402

fails = []


def check(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        fails.append(msg)


# ---- 1. review-route path guard (real code path) --------------------------
print("route guard: sighting-frame basenames")
with tempfile.TemporaryDirectory() as d:
    real = "cam_02_deadbeef_20260830T120000.jpg"
    open(os.path.join(d, real), "w").close()

    check(resolve_frame(real, d) == os.path.join(d, real), "valid frame resolves")
    check(resolve_frame("missing.jpg", d) is None, "absent file -> None")
    check(resolve_frame("../../etc/passwd", d) is None, "parent traversal rejected")
    check(resolve_frame("/etc/passwd", d) is None, "absolute path rejected")
    check(resolve_frame("a/b.jpg", d) is None, "nested separator rejected")
    check(resolve_frame("..", d) is None, "dotdot rejected")
    check(resolve_frame("", d) is None, "empty name rejected")
    check(safe_basename("plain.jpg") == "plain.jpg", "plain basename passes")
    check(safe_basename("a\\b") is None, "backslash separator rejected")


# ---- 2. schema parity: the SQL the Rust confirm depends on -----------------
print("schema parity: recompute_weight + migration 002")
init_sql = open(os.path.join(ROOT, "infra", "migrations", "001_init.sql")).read()
mig_sql = open(os.path.join(ROOT, "infra", "migrations", "002_cctv_evidence.sql")).read()

# The +10 the "edges thicken" claim rests on (§5.3 / §7.1).
import re  # noqa: E402
m = re.search(r"WHEN\s+'cctv_sighting'\s+THEN\s+(\d+)", init_sql)
check(m is not None and int(m.group(1)) == 10, "recompute_weight scores cctv_sighting = 10")
check("recompute_weight" in init_sql, "recompute_weight function present")

# 002 lets a sighting become evidence + a review.
check("ALTER COLUMN source_file_id DROP NOT NULL" in mig_sql,
      "002 relaxes evidence.source_file_id NOT NULL")
check("kind = 'cctv_sighting'" in mig_sql,
      "002 restricts the null-source exemption to cctv_sighting")
check("insight_reviews ALTER COLUMN object_id TYPE text" in mig_sql,
      "002 widens insight_reviews.object_id to text (bigint sighting ids)")


print()
if fails:
    print(f"FAILED ({len(fails)}): " + "; ".join(fails))
    sys.exit(1)
print("PASS — Phase 5 sandbox-provable surface green; confirm core verifies on the demo machine.")
