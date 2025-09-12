-- Add artist fields to member_profiles and backfill based on artists/contact/name aliases

BEGIN;

-- 1) Columns + constraint + indexes
ALTER TABLE public.member_profiles 
  ADD COLUMN IF NOT EXISTS artist_id TEXT,
  ADD COLUMN IF NOT EXISTS is_artist BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS artist_role TEXT DEFAULT 'owner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_artist_role' 
      AND conrelid = 'public.member_profiles'::regclass
  ) THEN
    ALTER TABLE public.member_profiles 
      ADD CONSTRAINT check_artist_role 
      CHECK (artist_role IN ('owner','manager','collaborator'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_member_profiles_artist_id ON public.member_profiles(artist_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_is_artist ON public.member_profiles(is_artist);

-- 2) Backfill by contact email exact match
UPDATE public.member_profiles mp
SET artist_id = a.legacy_id,
    is_artist = TRUE
FROM public.artists a
WHERE a.contact IS NOT NULL
  AND LOWER(a.contact) = LOWER(mp.email)
  AND (mp.artist_id IS DISTINCT FROM a.legacy_id OR mp.is_artist IS DISTINCT FROM TRUE);

-- 3) Backfill by name/alias match (best-effort)
CREATE OR REPLACE FUNCTION _normtxt(s text) RETURNS text AS $$
  SELECT lower(regexp_replace(coalesce(s,''), '\\s+', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

DROP TABLE IF EXISTS _aliases2;
CREATE TEMP TABLE _aliases2(a text, b text);
INSERT INTO _aliases2(a,b) VALUES
  ('주진태','더 밀리웨이스'),
  ('애크민','Zsthyger'),
  ('유동혁','동혁'),
  ('최원일','최기타'),
  ('김민우','anazao'),
  ('김민우','ANAZAO'),
  ('김민우','아나자오'),
  ('장현호','길가는밴드 장현호'),
  ('ambre','앰버'),
  ('남수현','남수');

WITH cand AS (
  SELECT mp.id AS member_id, mp.display_name, mp.real_name
  FROM public.member_profiles mp
), names AS (
  SELECT 
    c.member_id,
    _normtxt(c.display_name) AS dn,
    _normtxt(c.real_name) AS rn
  FROM cand c
), artist_names AS (
  SELECT a.legacy_id, a.slug, a.name, _normtxt(a.name) AS nn FROM public.artists a
), expanded AS (
  SELECT an.legacy_id, an.nn AS key FROM artist_names an
  UNION ALL
  SELECT an.legacy_id, _normtxt(al.b) FROM artist_names an JOIN _aliases2 al ON _normtxt(al.a) = an.nn
  UNION ALL
  SELECT an.legacy_id, _normtxt(al.a) FROM artist_names an JOIN _aliases2 al ON _normtxt(al.b) = an.nn
)
UPDATE public.member_profiles mp
SET artist_id = ex.legacy_id,
    is_artist = TRUE
FROM names n
JOIN expanded ex ON (n.dn = ex.key OR n.rn = ex.key)
WHERE mp.id = n.member_id
  AND (mp.artist_id IS DISTINCT FROM ex.legacy_id OR mp.is_artist IS DISTINCT FROM TRUE);

COMMIT;

