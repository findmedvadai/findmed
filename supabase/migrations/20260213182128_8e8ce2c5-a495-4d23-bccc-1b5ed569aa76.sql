
-- Add color column to specialties
ALTER TABLE public.specialties ADD COLUMN color text DEFAULT NULL;

-- Add email and initial_password to users for admin credential visibility
ALTER TABLE public.users ADD COLUMN email text DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN initial_password text DEFAULT NULL;
