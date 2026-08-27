-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- GGAC emergency recovery script: reconstruct data up to 2025-09-10 (KST)
-- Source of truth: user_activities logs (posts/comments/likes) and auth.users
-- Idempotent: safe to rerun (uses ON CONFLICT / NOT EXISTS guards)

--
-- Recovery up to 2025-09-10 23:59:59 KST
--

BEGIN;

-- Parameters
CREATE TEMP TABLE _recovery_params AS
SELECT (TIMESTAMPTZ '2025-09-10 23:59:59+09') AS cutoff;

-- A) Ensure member profiles from auth.users and activity
INSERT INTO public.member_profiles (id, email, display_name, registration_status, is_active, created_at, updated_at)
SELECT u.id,
       u.email,
       COALESCE(u.raw_user_meta_data->>'display_name', u.email),
       'pending',
       false,
       NOW(), NOW()
FROM auth.users u, _recovery_params p
WHERE u.created_at <= p.cutoff
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.member_profiles (id, email, display_name, registration_status, is_active, created_at, updated_at)
SELECT DISTINCT ua.user_id,
       au.email,
       COALESCE(au.raw_user_meta_data->>'display_name', au.email),
       'pending',
       false,
       NOW(), NOW()
FROM user_activities ua
JOIN auth.users au ON au.id = ua.user_id
JOIN _recovery_params p ON true
WHERE ua.created_at <= p.cutoff
ON CONFLICT (id) DO NOTHING;

-- Promote active users to approved if they created content before cutoff
UPDATE public.member_profiles mp
SET registration_status = 'approved', is_active = true, updated_at = NOW()
FROM (
  SELECT DISTINCT ua.user_id
  FROM user_activities ua, _recovery_params p
  WHERE ua.created_at <= p.cutoff
    AND ua.action_type IN ('post_created','comment_created')
) act
WHERE mp.id = act.user_id;

-- B) Posts restoration
INSERT INTO public.posts (id, title, content, category, author_id, created_at, updated_at, is_deleted, is_pinned, pinned_at)
SELECT p.id,
       COALESCE(p.title_raw, '[복구됨] 제목 미상') AS title,
       '[복구됨] 원문 본문은 로그에 저장되지 않아 복원할 수 없습니다.' AS content,
       COALESCE(p.category_raw, '잡담') AS category,
       p.author_id,
       p.created_at,
       p.created_at,
       false,
       (COALESCE(p.category_raw, '잡담') = '공지') AS is_pinned,
       CASE WHEN COALESCE(p.category_raw, '잡담') = '공지' THEN p.created_at ELSE NULL END AS pinned_at
FROM (
  SELECT (ua.target_id)::uuid AS id,
         ua.user_id AS author_id,
         NULLIF(ua.metadata->>'title','') AS title_raw,
         NULLIF(ua.metadata->>'category','') AS category_raw,
         ua.created_at AS created_at
  FROM user_activities ua, _recovery_params p
  WHERE ua.action_type = 'post_created'
    AND ua.created_at <= p.cutoff
) p
LEFT JOIN public.posts existing ON existing.id = p.id
WHERE existing.id IS NULL;

-- C) Comments restoration (placeholder content)
INSERT INTO public.comments (id, post_id, author_id, content, created_at, updated_at)
SELECT c.id, c.post_id, c.author_id,
       '[복구됨] 원문 댓글 내용은 로그에 없어 복구 불가' AS content,
       c.created_at, c.created_at
FROM (
  SELECT (ua.target_id)::uuid AS id,
         (ua.metadata->>'post_id')::uuid AS post_id,
         ua.user_id AS author_id,
         ua.created_at
  FROM user_activities ua, _recovery_params p
  WHERE ua.action_type = 'comment_created'
    AND ua.created_at <= p.cutoff
) c
JOIN public.posts p ON p.id = c.post_id
LEFT JOIN public.comments existing ON existing.id = c.id
WHERE existing.id IS NULL;

-- D) Likes restoration: replay last state <= cutoff
WITH like_events AS (
  SELECT ua.user_id, (ua.target_id)::uuid AS post_id, ua.action_type, ua.created_at, ua.id AS activity_id
  FROM user_activities ua, _recovery_params p
  WHERE ua.action_type IN ('like_added','like_removed')
    AND ua.created_at <= p.cutoff
), last_events AS (
  SELECT le.*, ROW_NUMBER() OVER (PARTITION BY user_id, post_id ORDER BY created_at DESC, activity_id DESC) AS rn
  FROM like_events le
), final_likes AS (
  SELECT user_id, post_id, created_at
  FROM last_events
  WHERE rn = 1 AND action_type = 'like_added'
)
INSERT INTO public.post_likes (post_id, user_id, created_at)
SELECT fl.post_id, fl.user_id, fl.created_at
FROM final_likes fl
JOIN public.posts p ON p.id = fl.post_id
LEFT JOIN public.post_likes pl ON pl.post_id = fl.post_id AND pl.user_id = fl.user_id
WHERE pl.id IS NULL;

-- Ensure like/view columns exist then recalc aggregates
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

UPDATE public.posts p
SET like_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT post_id, COUNT(*) AS cnt FROM public.post_likes GROUP BY post_id
) sub
WHERE p.id = sub.post_id;

UPDATE public.posts p
SET view_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT (ua.target_id)::uuid AS post_id, COUNT(*) AS cnt
  FROM user_activities ua, _recovery_params p
  WHERE ua.action_type = 'page_viewed'
    AND ua.target_type = 'post'
    AND ua.created_at <= p.cutoff
  GROUP BY (ua.target_id)::uuid
) sub
WHERE p.id = sub.post_id;

COMMIT;

-- Done
SELECT 'Recovery up to 2025-09-10 (KST) completed.' AS message;

