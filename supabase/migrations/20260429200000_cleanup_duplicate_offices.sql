-- Merge duplicate doctor_offices rows (same doctor_id + name, both active).
-- For each set of duplicates, the oldest row (lowest created_at) is kept.
-- Appointments are re-pointed to the original; availability and sessions for
-- the duplicate are deleted (to avoid overlap conflicts).
-- After cleanup, add a partial unique index to prevent future duplicates.

WITH
ranked AS (
  SELECT
    id,
    doctor_id,
    name,
    ROW_NUMBER() OVER (PARTITION BY doctor_id, name ORDER BY created_at ASC) AS rn
  FROM doctor_offices
  WHERE is_active = true AND is_deleted = false
),
dup_map AS (
  SELECT r.id AS dup_id, o.id AS orig_id
  FROM ranked r
  JOIN ranked o ON r.doctor_id = o.doctor_id AND r.name = o.name AND o.rn = 1
  WHERE r.rn > 1
),
fix_appointments AS (
  UPDATE appointments
  SET office_id = dup_map.orig_id
  FROM dup_map
  WHERE office_id = dup_map.dup_id
  RETURNING appointments.id
),
del_availability AS (
  DELETE FROM doctor_weekly_availability
  USING dup_map
  WHERE office_id = dup_map.dup_id
  RETURNING doctor_weekly_availability.id
),
del_sessions AS (
  DELETE FROM reservation_sessions
  USING dup_map
  WHERE office_id = dup_map.dup_id
  RETURNING reservation_sessions.id
)
UPDATE doctor_offices
SET is_deleted = true, is_active = false, updated_at = now()
FROM dup_map
WHERE doctor_offices.id = dup_map.dup_id;

-- Prevent future duplicates: only one active non-deleted office per (doctor, name).
CREATE UNIQUE INDEX IF NOT EXISTS doctor_offices_active_name_unique
  ON doctor_offices (doctor_id, name)
  WHERE is_active = true AND is_deleted = false;
