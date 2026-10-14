-- Nearest options for the WhatsApp agent (client request, 14-oct-2026):
-- "no tengo en Chimalhuacán pero tengo en la Roma, en Naucalpan… y estos son
-- los horarios". search_care_options ranks offices by straight-line distance
-- (Haversine in _shared/geo.ts) from the patient's place to the office's zone
-- (or, if the zone has no coordinates, its city).
--
--  1. latitude/longitude on zones and cities (nullable, approximate centroid,
--     editable in Configuración → Catálogos). CHECK: both or neither, and
--     inside Mexico's bounding box (catches swapped or sign-less values).
--  2. Seed of the zones/cities that exist in production (14-oct-2026), by
--     name, only where still NULL. Not seeded on purpose (no single place to
--     point at): zones "Centro Poniente", "Norte", "Poniente", "Sur" and the
--     city "Estado de México" (it is a state; its centroid would sit near
--     Toluca, ~50 km from the metro offices). Offices in those zones fall back
--     to their city's point; FindMed can set them from the panel.
--  3. geo_cache: results of the optional geocoder (Nominatim / OpenStreetMap)
--     for places that are neither in the catalog nor in the local gazetteer.
--     Written only by Edge Functions (service role); admins can read it.

-- 1. Columns ------------------------------------------------------------------------

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9, 6);

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9, 6);

-- The IS NOT NULL terms matter: a CHECK that evaluates to NULL passes, so
-- "lat BETWEEN … AND lon BETWEEN …" alone would accept a latitude without longitude.
ALTER TABLE public.zones
  ADD CONSTRAINT zones_coordinates_valid CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN 14 AND 33 AND longitude BETWEEN -119 AND -86)
  );

ALTER TABLE public.cities
  ADD CONSTRAINT cities_coordinates_valid CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN 14 AND 33 AND longitude BETWEEN -119 AND -86)
  );

COMMENT ON COLUMN public.zones.latitude IS 'Approximate centroid (WGS84). Used to rank offices by distance in search_care_options.';
COMMENT ON COLUMN public.cities.latitude IS 'Approximate centroid (WGS84). Fallback point for offices whose zone has no coordinates.';

-- 2. Seed (production names; accent/case-insensitive match; never overwrites) -------
-- Zones are matched by name only, not by city: some zones are assigned to the
-- wrong city in the catalog (Huixquilucan and Satélite are in the Estado de
-- México but listed under Ciudad de México) and the point must be right anyway.

WITH seed(name, lat, lon) AS (
  VALUES
    ('Condesa',                 19.411000, -99.173000),
    ('Cuauhtemoc',              19.433000, -99.149000),
    ('Escandon',                19.403000, -99.180000),
    ('Huixquilucan',            19.390000, -99.290000), -- urban area (Interlomas / Bosques), not the municipal seat
    ('Lomas',                   19.425000, -99.215000), -- Lomas de Chapultepec
    ('Observatorio (poniente)', 19.403000, -99.200000),
    ('Pedregal',                19.315000, -99.205000), -- Jardines del Pedregal
    ('Roma',                    19.417000, -99.160000),
    ('Satelite',                19.510000, -99.235000), -- Ciudad Satélite (Naucalpan)
    ('Ecatepec',                19.601000, -99.050000),
    ('Naucalpan',               19.478000, -99.239000),
    ('Tecamac',                 19.713000, -98.968000),
    ('Tlalnepantla',            19.540000, -99.195000)
)
UPDATE public.zones z
SET latitude = s.lat, longitude = s.lon
FROM seed s
WHERE lower(translate(z.name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = lower(s.name)
  AND z.latitude IS NULL
  AND z.longitude IS NULL;

WITH seed(name, lat, lon) AS (
  VALUES
    ('Aguascalientes',   21.881800, -102.291600),
    ('Celaya',           20.523500, -100.815700),
    ('Ciudad de Mexico', 19.432600,  -99.133200),
    ('Guadalajara',      20.659700, -103.349600),
    ('Guanajuato',       21.019000, -101.257400),
    ('Queretaro',        20.588800, -100.389900),
    ('Toluca',           19.282600,  -99.655700),
    ('Veracruz',         19.173800,  -96.134200)
)
UPDATE public.cities c
SET latitude = s.lat, longitude = s.lon
FROM seed s
WHERE lower(translate(c.name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = lower(s.name)
  AND c.latitude IS NULL
  AND c.longitude IS NULL;

-- 3. Geocoder cache ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.geo_cache (
  query_key text PRIMARY KEY CHECK (char_length(query_key) BETWEEN 1 AND 200),
  query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 200),
  found boolean NOT NULL,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 300),
  provider text NOT NULL DEFAULT 'nominatim',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_cache_point_when_found CHECK (
    (found AND latitude IS NOT NULL AND longitude IS NOT NULL
       AND latitude BETWEEN 14 AND 33 AND longitude BETWEEN -119 AND -86)
    OR (NOT found AND latitude IS NULL AND longitude IS NULL)
  )
);

COMMENT ON TABLE public.geo_cache IS 'Geocoder results (found or not) for free-text places said by patients. Written by Edge Functions only; "not found" is retried after 30 days.';

ALTER TABLE public.geo_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read geo_cache" ON public.geo_cache;
CREATE POLICY "Admins can read geo_cache" ON public.geo_cache
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
