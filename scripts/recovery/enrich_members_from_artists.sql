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

