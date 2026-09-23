-- D33 follow-up, part 3: cases and case_assignments must survive a
-- server restart. Until now the server's in-memory CaseStore and
-- AssignmentStore were the only place this data lived after creation
-- -- POST /cases dual-writes to Postgres (20260920000001), but nothing
-- ever reads it back, and case_assignments was never written to
-- Postgres at all. A restart silently discarded both (rule 9 concern:
-- a wiped case list looks like "no cases exist" rather than a visible
-- failure).
--
-- Same least-privilege shape as the other saga migrations: the D33
-- role migration already GRANTed raven_saga SELECT on cases and
-- case_assignments, but GRANTs alone do not satisfy RLS (auth.uid() is
-- NULL in the saga's session, so the baseline case_visible /
-- assignment_visible policies deny every row). This adds permissive
-- policies scoped TO raven_saga only; every other role keeps the
-- baseline policies unchanged, and there is still no user-JWT path
-- that bypasses has_case_access()/assignment ownership.

BEGIN;

CREATE POLICY saga_select ON cases
  FOR SELECT TO raven_saga USING (true);

GRANT INSERT, UPDATE ON case_assignments TO raven_saga;

CREATE POLICY saga_select ON case_assignments
  FOR SELECT TO raven_saga USING (true);
CREATE POLICY saga_insert ON case_assignments
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_update ON case_assignments
  FOR UPDATE TO raven_saga USING (true) WITH CHECK (true);

COMMIT;
