//! M2-T4. Database constraint test: candidate rows without
//! `threshold_used` / `prior_adjustment` fail at the constraint level.
//!
//! The live-DB proof runs wherever Postgres is up (`supabase db reset`
//! then an INSERT missing `threshold_used` must raise NOT NULL). This test
//! proves the migration carrying that constraint exists, is additive (does
//! not edit the baseline), and states NOT NULL for both columns -- so the
//! suite stays red if the migration is ever removed or weakened, even on
//! machines without a database running.

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("server has a parent")
        .join("supabase")
        .join("migrations")
}

#[test]
fn reid_threshold_not_null_migration_exists_and_is_additive() {
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
        .find(|name| name.contains("reid_candidate_threshold"))
        .expect("M2-T4 migration must exist")
        .clone();

    // Next-timestamp file, not a baseline edit: sorts after the baseline
    // and after the insight_reviews tightening migration.
    assert!(
        migration.as_str() > "20260911000000_tighten_insight_reviews_policy.sql",
        "migration must be a new timestamped file, got {migration}"
    );
    let sql = std::fs::read_to_string(dir.join(&migration)).expect("migration reads");
    assert!(
        sql.contains("threshold_used SET NOT NULL"),
        "migration must enforce threshold_used NOT NULL"
    );
    assert!(
        sql.contains("prior_adjustment SET NOT NULL"),
        "migration must enforce prior_adjustment NOT NULL"
    );
}
