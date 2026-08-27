-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Enrich member_profiles using artists and member_login_history/user_activities
-- Idempotent and safe to rerun

BEGIN;

-- 1) Latest successful login per member
CREATE TEMP TABLE _latest_login AS
SELECT member_id, MAX(login_at) AS last_login
FROM public.member_login_history
WHERE COALESCE(success, true) = true
GROUP BY member_id;

-- 2) Activity aggregates per member
CREATE TEMP TABLE _activity AS
SELECT user_id,
       COUNT(*) AS total_activities,
       COUNT(*) FILTER (WHERE action_type IN ('post_created','comment_created')) AS content_activities,
       MIN(created_at) AS first_activity,
       MAX(created_at) AS last_activity
FROM public.user_activities
GROUP BY user_id;

-- 3) Artists contact-to-email mapping (contact may contain email in free text)
CREATE TEMP TABLE _artist_email_map AS
SELECT a.id AS artist_id,
       a.name AS artist_name,
       a.contact AS artist_contact,
       LOWER(NULLIF(TRIM(a.contact), '')) AS contact_lower
FROM public.artists a;

-- 4) Update last_login_at from login history
UPDATE public.member_profiles mp
SET last_login_at = GREATEST(COALESCE(mp.last_login_at, to_timestamp(0)), ll.last_login),
    updated_at = NOW()
FROM _latest_login ll
WHERE mp.id = ll.member_id
  AND (mp.last_login_at IS NULL OR ll.last_login > mp.last_login_at);

-- 5) Engagement score based on activity
UPDATE public.member_profiles mp
SET engagement_score = LEAST(1000, COALESCE(act.total_activities,0) * 1 + COALESCE(act.content_activities,0) * 4),
    updated_at = NOW()
FROM _activity act
WHERE act.user_id = mp.id;

-- 6) Display/real name from artists when display_name is fallback (=email) or real_name is null
UPDATE public.member_profiles mp
SET display_name = COALESCE(NULLIF(mp.display_name, mp.email), am.artist_name),
    real_name = COALESCE(mp.real_name, am.artist_name),
    membership_type = COALESCE(mp.membership_type, 'artist'),
    updated_at = NOW()
FROM _artist_email_map am
WHERE (
  (am.contact_lower = LOWER(mp.email))
  OR (am.contact_lower IS NOT NULL AND POSITION(LOWER(mp.email) IN am.contact_lower) > 0)
)
AND (mp.display_name = mp.email OR mp.real_name IS NULL OR mp.membership_type IS NULL);

-- 7) is_member heuristic: approved/active OR has activity OR has successful login
UPDATE public.member_profiles mp
SET is_member = TRUE,
    updated_at = NOW()
FROM (
  SELECT id FROM public.member_profiles mp2
  LEFT JOIN _activity act ON act.user_id = mp2.id
  LEFT JOIN _latest_login ll ON ll.member_id = mp2.id
  WHERE (mp2.registration_status = 'approved' AND mp2.is_active = TRUE)
     OR (COALESCE(act.total_activities,0) > 0)
     OR (ll.last_login IS NOT NULL)
) s
WHERE s.id = mp.id AND mp.is_member IS DISTINCT FROM TRUE;

COMMIT;

-- Summary
SELECT 'profiles_total' AS label, COUNT(*) FROM public.member_profiles;
SELECT 'with_last_login' AS label, COUNT(*) FROM public.member_profiles WHERE last_login_at IS NOT NULL;
SELECT 'members_true' AS label, COUNT(*) FROM public.member_profiles WHERE is_member IS TRUE;
SELECT 'engagement_avg' AS label, AVG(COALESCE(engagement_score,0)) FROM public.member_profiles;

