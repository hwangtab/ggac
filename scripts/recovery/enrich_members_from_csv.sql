-- Enrich member_profiles using docs/members.csv (Korean headers)
-- Safe defaults: only fill NULL or placeholder fields; match by lower(email)

\echo 'Starting CSV-based enrichment'
BEGIN;

-- 0) Staging raw table
DROP TABLE IF EXISTS _member_csv_raw;
CREATE TEMP TABLE _member_csv_raw (
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

-- 1) Load CSV (client-side path)
\copy _member_csv_raw FROM 'docs/members.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- 2) Normalize values
DROP TABLE IF EXISTS _member_csv_norm;
CREATE TEMP TABLE _member_csv_norm AS
WITH base AS (
  SELECT
    email,
    LOWER(TRIM(email)) AS email_lower,
    NULLIF(TRIM(name), '') AS name,
    NULLIF(TRIM(phone), '') AS phone,
    monthly_fee_raw,
    NULLIF(TRIM(bank_name), '') AS bank_name,
    NULLIF(TRIM(account_number), '') AS account_number,
    NULLIF(TRIM(account_holder), '') AS account_holder,
    NULLIF(TRIM(birth_raw), '') AS birth_raw,
    NULLIF(TRIM(other_amount), '') AS other_amount
  FROM _member_csv_raw
  WHERE email IS NOT NULL AND TRIM(email) <> ''
), fee AS (
  SELECT
    *,
    -- parse fee to integer KRW
    CASE
      WHEN monthly_fee_raw ILIKE '%만원%'
        THEN (NULLIF(regexp_replace(monthly_fee_raw, '[^0-9]', '', 'g'), ''))::int * 10000
      WHEN monthly_fee_raw ILIKE '%기타%'
        THEN NULLIF(regexp_replace(coalesce(other_amount,''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS monthly_fee
  FROM base
), birth AS (
  SELECT
    *,
    -- strip to digits
    regexp_replace(coalesce(birth_raw,''), '[^0-9]', '', 'g') AS birth_digits
  FROM fee
), birth_parsed AS (
  SELECT
    *,
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
SELECT DISTINCT ON (email_lower)
  email_lower,
  name,
  phone,
  monthly_fee,
  bank_name,
  account_number,
  account_holder,
  birth_date
FROM birth_parsed
ORDER BY email_lower, name NULLS LAST;

-- 3) Preview matches
\echo 'Preview matches:'
SELECT COUNT(*) AS csv_rows FROM _member_csv_norm;
SELECT COUNT(*) AS csv_matched
FROM _member_csv_norm c
JOIN public.member_profiles mp ON LOWER(mp.email) = c.email_lower;

-- 4) Apply updates (safe: only fill when NULL or placeholder)
-- display_name: replace if equals email
UPDATE public.member_profiles mp
SET display_name = COALESCE(c.name, mp.display_name),
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND (mp.display_name IS NULL OR mp.display_name = mp.email);

-- real_name
UPDATE public.member_profiles mp
SET real_name = c.account_holder,
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND c.account_holder IS NOT NULL
  AND (mp.real_name IS NULL OR mp.real_name = '' OR mp.real_name = mp.display_name);

-- phone_number
UPDATE public.member_profiles mp
SET phone_number = c.phone,
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND c.phone IS NOT NULL
  AND (mp.phone_number IS NULL OR mp.phone_number = '');

-- monthly_fee
UPDATE public.member_profiles mp
SET monthly_fee = c.monthly_fee,
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND c.monthly_fee IS NOT NULL
  AND (mp.monthly_fee IS NULL OR mp.monthly_fee <= 0);

-- bank/account/account_holder
UPDATE public.member_profiles mp
SET bank_name = COALESCE(mp.bank_name, c.bank_name),
    account_number = COALESCE(mp.account_number, c.account_number),
    account_holder = COALESCE(mp.account_holder, c.account_holder),
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND (c.bank_name IS NOT NULL OR c.account_number IS NOT NULL OR c.account_holder IS NOT NULL)
  AND (mp.bank_name IS NULL OR mp.account_number IS NULL OR mp.account_holder IS NULL);

-- birth_date
UPDATE public.member_profiles mp
SET birth_date = c.birth_date,
    updated_at = NOW()
FROM _member_csv_norm c
WHERE LOWER(mp.email) = c.email_lower
  AND c.birth_date IS NOT NULL
  AND mp.birth_date IS NULL;

COMMIT;

-- 5) Reports
\echo 'Updated rows by field:'
SELECT 'display_name_set' AS label, COUNT(*) FROM public.member_profiles WHERE display_name IS NOT NULL AND display_name <> email;
SELECT 'real_name_set' AS label, COUNT(*) FROM public.member_profiles WHERE real_name IS NOT NULL AND real_name <> '';
SELECT 'phone_set' AS label, COUNT(*) FROM public.member_profiles WHERE phone_number IS NOT NULL AND phone_number <> '';
SELECT 'monthly_fee_set' AS label, COUNT(*) FROM public.member_profiles WHERE monthly_fee IS NOT NULL AND monthly_fee > 0;
SELECT 'bank_info_set' AS label, COUNT(*) FROM public.member_profiles WHERE bank_name IS NOT NULL OR account_number IS NOT NULL;
SELECT 'birth_date_set' AS label, COUNT(*) FROM public.member_profiles WHERE birth_date IS NOT NULL;

-- Unmatched CSV emails: export via external psql COPY in shell
\echo 'CSV enrichment done (run external COPY to export unmatched emails)'
