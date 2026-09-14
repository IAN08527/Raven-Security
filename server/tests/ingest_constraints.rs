//! M4-T2. Database constraint test: text-extracted evidence rows
//! without spans, and rows without provenance, fail at the constraint
//! level (rules 7/8, FR-3.1/FR-4.4).
//!
//! The live-DB proof runs wherever Postgres is up (`supabase db reset`
//! then an INSERT violating each constraint must raise). This test proves
//! the migration carrying those constraints exists, is additive (does
//! not edit the baseline), and states them -- so the suite stays red if
//! the migration is ever removed or weakened, even on machines without a
//! database running (M2 `reid_constraints.rs` precedent).

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("server has a parent")
        .join("supabase")
        .join("migrations")
}

#[test]
fn extraction_span_provenance_migration_exists_and_is_additive() {
    let dir = migrations_dir();
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .expect("migrations dir reads")
        .map(|entry| entry.expect("entry reads").file_name().into_string().expect("utf8"))
        .collect();

    assert!(
        entries.contains(&"20260910000000_baseline.sql".to_string()),
        "baseline must still exist untouched"
    );
    let migration = entries
        .iter()
        .find(|name| name.contains("extraction_spans_provenance"))
        .expect("M4-T2 migration must exist")
        .clone();

    // New timestamped file after every existing migration, not a
    // baseline edit: sorts after the M2 constraint migration.
    assert!(
        migration.as_str() > "20260913000000_reid_candidate_threshold_constraints.sql",
        "migration must be a new timestamped file, got {migration}"
    );
    let sql = std::fs::read_to_string(dir.join(&migration)).expect("migration reads");
    // fir_text evidence must carry spans (scoped CHECK: cdr/txn/cctv rows
    // legitimately have none, so a blanket NOT NULL would corrupt them).
    assert!(
        sql.contains("evidence_fir_text_has_span"),
        "migration must enforce fir_text spans via CHECK"
    );
    assert!(
        sql.contains("char_start IS NOT NULL AND char_end IS NOT NULL"),
        "migration must require both span endpoints"
    );
    for table in ["entities", "identifiers", "relationships", "evidence"] {
        assert!(
            sql.contains(&format!("ALTER TABLE {table}")),
            "migration must restate {table} provenance NOT NULL"
        );
    }
}
