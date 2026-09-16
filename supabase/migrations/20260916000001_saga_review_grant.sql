-- D33 amendment (D36 structured path): the ingest saga queues structured
-- files for human schema-mapping review via INSERT INTO review_items,
-- which the saga-role migration omitted. One-line follow-up granting it.

BEGIN;

GRANT INSERT ON review_items TO raven_saga;

COMMIT;
