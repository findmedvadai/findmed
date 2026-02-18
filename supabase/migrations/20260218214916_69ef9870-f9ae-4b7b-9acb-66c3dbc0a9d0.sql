-- Note: cancel_reason enum already has 'no_confirmation' based on the types.ts file
-- The types.ts shows: cancel_reason: "patient" | "doctor" | "no_confirmation"
-- So no migration is needed for the enum

-- However, we need to verify the enum exists correctly - if it doesn't, add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'no_confirmation' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cancel_reason')
  ) THEN
    ALTER TYPE cancel_reason ADD VALUE 'no_confirmation';
  END IF;
END$$;
