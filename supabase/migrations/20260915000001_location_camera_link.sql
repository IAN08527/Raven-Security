-- Link camera-sourced location points to their source camera (FR-6.1).
-- Lets movement tooltips show the source's declared_start_ts (D16)
-- instead of inventing an anchor. Non-camera origins (cdr, fir,
-- address) keep camera_id NULL: their anchor is the source file.
-- Additive only; baseline untouched (rule 5).

ALTER TABLE location_history
  ADD COLUMN camera_id uuid REFERENCES cameras(id) ON DELETE SET NULL;

CREATE INDEX ON location_history (camera_id);
