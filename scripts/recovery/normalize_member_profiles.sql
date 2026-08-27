-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Normalize member_profiles formats (phone, bank_name, account_number)
-- Safe: logs changes to public.member_profiles_normalize_log

BEGIN;

-- Change log table
CREATE TABLE IF NOT EXISTS public.member_profiles_normalize_log (
  id BIGSERIAL PRIMARY KEY,
  member_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helpers
CREATE OR REPLACE FUNCTION _digits_only(s text) RETURNS text AS $$
  SELECT regexp_replace(coalesce(s,''), '[^0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _normalize_phone(s text) RETURNS text AS $$
DECLARE
  d text := _digits_only(s);
  out text;
BEGIN
  IF length(d) = 11 AND substring(d,1,3) IN ('010','011','016','017','018','019') THEN
    out := substring(d,1,3) || '-' || substring(d,4,4) || '-' || substring(d,8,4);
  ELSIF length(d) = 10 AND substring(d,1,2) = '02' THEN
    out := '02-' || substring(d,3,4) || '-' || substring(d,7,4);
  ELSIF length(d) = 10 THEN
    out := substring(d,1,3) || '-' || substring(d,4,3) || '-' || substring(d,7,4);
  ELSE
    out := d; -- fallback as digits-only
  END IF;
  RETURN out;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _normalize_bank_name(s text) RETURNS text AS $$
DECLARE
  t text := lower(regexp_replace(coalesce(s,''), '\\s+', '', 'g'));
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  -- Common mappings
  IF t LIKE 'keb%하나%' OR t LIKE '하나은행' OR t = '하나' THEN RETURN '하나은행'; END IF;
  IF t LIKE '국민%' THEN RETURN '국민은행'; END IF;
  IF t LIKE '신한%' THEN RETURN '신한은행'; END IF;
  IF t LIKE '우리%' THEN RETURN '우리은행'; END IF;
  IF t LIKE 'nh농협%' OR t LIKE '농협%' THEN RETURN '농협은행'; END IF;
  IF t LIKE 'ibk기업%' OR t LIKE '기업은행' OR t = 'ibk' OR t = '기업' THEN RETURN 'IBK기업은행'; END IF;
  IF t LIKE 'sc제일%' OR t = 'sc' THEN RETURN 'SC제일은행'; END IF;
  IF t LIKE '카카오%' THEN RETURN '카카오뱅크'; END IF;
  RETURN s; -- default keep
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Phone normalization
WITH cand AS (
  SELECT id, phone_number AS old_val, _normalize_phone(phone_number) AS new_val
  FROM public.member_profiles
  WHERE phone_number IS NOT NULL AND phone_number <> ''
), upd AS (
  UPDATE public.member_profiles mp
  SET phone_number = c.new_val,
      updated_at = NOW()
  FROM cand c
  WHERE mp.id = c.id AND c.new_val IS NOT NULL AND c.new_val <> c.old_val
  RETURNING mp.id, c.old_val, c.new_val
)
INSERT INTO public.member_profiles_normalize_log(member_id, field_name, old_value, new_value)
SELECT id, 'phone_number', old_val, new_val FROM upd;

-- Account number normalization (digits only)
WITH cand AS (
  SELECT id, account_number AS old_val, _digits_only(account_number) AS new_val
  FROM public.member_profiles
  WHERE account_number IS NOT NULL AND account_number <> ''
), upd AS (
  UPDATE public.member_profiles mp
  SET account_number = NULLIF(c.new_val,''),
      updated_at = NOW()
  FROM cand c
  WHERE mp.id = c.id AND c.new_val IS NOT NULL AND c.new_val <> c.old_val
  RETURNING mp.id, c.old_val, c.new_val
)
INSERT INTO public.member_profiles_normalize_log(member_id, field_name, old_value, new_value)
SELECT id, 'account_number', old_val, new_val FROM upd;

-- Bank name normalization
WITH cand AS (
  SELECT id, bank_name AS old_val, _normalize_bank_name(bank_name) AS new_val
  FROM public.member_profiles
  WHERE bank_name IS NOT NULL AND bank_name <> ''
), upd AS (
  UPDATE public.member_profiles mp
  SET bank_name = c.new_val,
      updated_at = NOW()
  FROM cand c
  WHERE mp.id = c.id AND c.new_val IS NOT NULL AND c.new_val <> c.old_val
  RETURNING mp.id, c.old_val, c.new_val
)
INSERT INTO public.member_profiles_normalize_log(member_id, field_name, old_value, new_value)
SELECT id, 'bank_name', old_val, new_val FROM upd;

COMMIT;

-- Summary
SELECT field_name, COUNT(*) AS changes
FROM public.member_profiles_normalize_log
WHERE changed_at > NOW() - INTERVAL '10 minutes'
GROUP BY field_name
ORDER BY field_name;

