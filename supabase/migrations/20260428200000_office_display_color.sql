-- =============================================
-- Add display_color to doctor_offices.
-- =============================================
-- Visual identifier for each office in calendars and lists. Auto-assigned at
-- insert time when not provided; existing rows get a deterministic color
-- based on their creation order so the doctor can re-pick later from the UI.
--
-- Palette is a small sober set chosen to read well on white backgrounds at
-- 4px borders. Order matters — we use modulo on a row-number to spread.

ALTER TABLE public.doctor_offices
  ADD COLUMN IF NOT EXISTS display_color text NOT NULL DEFAULT '#2563EB';

-- Backfill existing rows. CTE assigns each office a 0-based ordinal among
-- its sibling offices for the same doctor (oldest = 0), then picks a color
-- by ordinal % palette_size.
DO $$
DECLARE
  palette text[] := ARRAY[
    '#2563EB', -- blue
    '#16A34A', -- green
    '#DC2626', -- red
    '#9333EA', -- purple
    '#EA580C', -- orange
    '#0D9488', -- teal
    '#DB2777', -- pink
    '#65A30D'  -- lime
  ];
BEGIN
  UPDATE public.doctor_offices o
  SET display_color = palette[(rn % array_length(palette, 1)) + 1]
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY doctor_id ORDER BY created_at ASC) - 1 AS rn
    FROM public.doctor_offices
  ) sub
  WHERE o.id = sub.id;
END $$;
