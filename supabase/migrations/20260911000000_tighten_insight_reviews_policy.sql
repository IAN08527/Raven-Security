-- M0-T4. The baseline's `via_case` policy on insight_reviews is USING (true):
-- any authenticated user can read any case's reviews, because object_id is a
-- polymorphic reference and the baseline had no per-type join to check.
--
-- Tighten it to a real case-access check dispatched on object_type. Two of the
-- four object_types cannot be checked correctly today: insight_reviews.object_id
-- is uuid, but reid_candidates.id and entity_merges.id are bigserial (bigint).
-- There is no way to resolve a 'candidate' or 'merge' review's parent row
-- through object_id as it is typed, so those branches fail closed (deny)
-- rather than staying open. Fixing this for real needs a schema change
-- (bigint -> uuid on reid_candidates.id and entity_merges.id, or a typed
-- discriminated FK on insight_reviews) tracked as a follow-up, not done here
-- per the additive-migrations rule.

BEGIN;

CREATE OR REPLACE FUNCTION insight_review_case_access(obj_type text, obj_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE obj_type
    WHEN 'relationship' THEN EXISTS (
      SELECT 1 FROM relationships r
       WHERE r.id = obj_id AND has_case_access(r.case_id)
    )
    WHEN 'entity' THEN EXISTS (
      SELECT 1 FROM entities e
       WHERE e.id = obj_id AND has_case_access(e.case_id)
    )
    -- 'candidate' (reid_candidates.id) and 'merge' (entity_merges.id) are
    -- bigserial, not uuid: object_id can never match a real row. Fail closed
    -- rather than resolve nothing and pass by accident.
    ELSE false
  END;
$$;

DROP POLICY IF EXISTS via_case ON insight_reviews;

CREATE POLICY via_case ON insight_reviews
  FOR SELECT USING (insight_review_case_access(object_type, object_id));

COMMIT;
