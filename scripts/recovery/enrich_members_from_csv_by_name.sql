-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Enrich member_profiles using docs/members.csv by NAME/ALIAS (no account creation)
-- Notes:
--  - Matches existing rows by display_name/real_name vs CSV name/account_holder and manual aliases
--  - Excludes known sponsor-only entries (e.g., 강성실)
--  - Safe updates: fill NULL/placeholder fields only

BEGIN;

-- Load CSV into temp (if not present from previous script)
DROP TABLE IF EXISTS _member_csv_raw2;
CREATE TEMP TABLE _member_csv_raw2 (
  ts_text TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  monthly_fee_raw TEXT,
  bank_name TEXT,
  account_number TEXT,
  birth_raw TEXT,
  account_holder TEXT,
  consent TEXT,
  other_amount TEXT
);

\copy _member_csv_raw2 FROM 'docs/members.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- Normalize + parse
DROP TABLE IF EXISTS _member_csv_norm2;
CREATE TEMP TABLE _member_csv_norm2 AS
WITH base AS (
  SELECT
    NULLIF(TRIM(name), '') AS name,
    NULLIF(TRIM(account_holder), '') AS account_holder,
    LOWER(TRIM(email)) AS email_lower,
    NULLIF(TRIM(phone), '') AS phone,
    monthly_fee_raw,
    NULLIF(TRIM(bank_name), '') AS bank_name,
    NULLIF(TRIM(account_number), '') AS account_number,
    NULLIF(TRIM(birth_raw), '') AS birth_raw,
    NULLIF(TRIM(other_amount), '') AS other_amount
  FROM _member_csv_raw2
)
, fee AS (
  SELECT *,
    CASE
      WHEN monthly_fee_raw ILIKE '%만원%'
        THEN (NULLIF(regexp_replace(monthly_fee_raw, '[^0-9]', '', 'g'), ''))::int * 10000
      WHEN monthly_fee_raw ILIKE '%기타%'
        THEN NULLIF(regexp_replace(coalesce(other_amount,''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS monthly_fee
  FROM base
)
, birth AS (
  SELECT *, regexp_replace(coalesce(birth_raw,''), '[^0-9]', '', 'g') AS birth_digits FROM fee
)
, birth_parsed AS (
  SELECT *,
    CASE
      WHEN length(birth_digits) = 8 THEN to_date(birth_digits, 'YYYYMMDD')
      WHEN length(birth_digits) = 6 THEN to_date(
        CASE WHEN (substring(birth_digits,1,2))::int >= 30
             THEN '19' || birth_digits
             ELSE '20' || birth_digits
        END,
        'YYYYMMDD')
      ELSE NULL
    END AS birth_date
  FROM birth
)
SELECT DISTINCT
  name,
  account_holder,
  email_lower,
  phone,
  monthly_fee,
  bank_name,
  account_number,
  birth_date
FROM birth_parsed
WHERE coalesce(name, account_holder) IS NOT NULL
  AND coalesce(name, account_holder) NOT IN ('K') -- 노이즈 제거
  AND coalesce(account_holder, '') <> '강성실'; -- sponsor-only, skip

-- Manual alias map
DROP TABLE IF EXISTS _aliases;
CREATE TEMP TABLE _aliases (
  a TEXT,
  b TEXT
);

INSERT INTO _aliases(a,b) VALUES
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

-- name candidates per CSV row
DROP TABLE IF EXISTS _csv_name_candidates;
CREATE TEMP TABLE _csv_name_candidates AS
WITH names AS (
  SELECT
    COALESCE(NULLIF(TRIM(name),''), NULLIF(TRIM(account_holder),'')) AS key_name,
    name,
    account_holder,
    email_lower,
    phone, monthly_fee, bank_name, account_number, birth_date
  FROM _member_csv_norm2
)
, expanded AS (
  SELECT n.*, n.key_name AS candidate FROM names n
  UNION ALL
  SELECT n.*, a.b AS candidate FROM names n
  JOIN _aliases a ON a.a = n.key_name
  UNION ALL
  SELECT n.*, a.a AS candidate FROM names n
  JOIN _aliases a ON a.b = n.key_name
)
SELECT DISTINCT
  candidate,
  name,
  account_holder,
  email_lower,
  phone, monthly_fee, bank_name, account_number, birth_date
FROM expanded
WHERE candidate IS NOT NULL;

-- utility normalize
CREATE OR REPLACE FUNCTION _norm(s text) RETURNS text AS $$
  SELECT lower(regexp_replace(coalesce(s,''), '\\s+', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- Match by display_name/real_name contains or equals
DROP TABLE IF EXISTS _matches;
CREATE TEMP TABLE _matches AS
SELECT 
  mp.id AS member_id,
  mp.email AS member_email,
  mp.display_name,
  mp.real_name,
  c.email_lower AS csv_email,
  c.name AS csv_name,
  c.account_holder AS csv_holder,
  c.phone,
  c.monthly_fee,
  c.bank_name,
  c.account_number,
  c.birth_date
FROM public.member_profiles mp
JOIN _csv_name_candidates c
  ON (
    _norm(mp.display_name) = _norm(c.candidate)
    OR _norm(mp.real_name) = _norm(c.candidate)
    OR _norm(mp.display_name) LIKE '%' || _norm(c.candidate) || '%'
    OR _norm(mp.real_name) LIKE '%' || _norm(c.candidate) || '%'
  );

-- Apply safe updates
UPDATE public.member_profiles mp
SET 
  display_name = CASE WHEN mp.display_name = mp.email AND m.csv_name IS NOT NULL THEN m.csv_name ELSE mp.display_name END,
  real_name     = COALESCE(mp.real_name, m.csv_holder, m.csv_name),
  phone_number  = COALESCE(NULLIF(mp.phone_number,''), m.phone),
  monthly_fee   = COALESCE(mp.monthly_fee, m.monthly_fee),
  bank_name     = COALESCE(mp.bank_name, m.bank_name),
  account_number= COALESCE(mp.account_number, m.account_number),
  account_holder= COALESCE(mp.account_holder, COALESCE(m.csv_holder, m.csv_name)),
  birth_date    = COALESCE(mp.birth_date, m.birth_date),
  updated_at    = NOW()
FROM _matches m
WHERE mp.id = m.member_id;

COMMIT;

-- Report
SELECT 'name_alias_matches' AS label, COUNT(*) FROM _matches;

