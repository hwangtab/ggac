-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- ============================================================================
-- Supabase RPC: get_posts_meta
-- Purpose  : Return batched metadata for posts (comment counts and user likes)
-- Signature: get_posts_meta(p_post_ids uuid[], p_user_id uuid)
-- Returns  : jsonb -> { comments: { <post_id>: <count>, ... }, user_liked: [<post_id>, ...] }
-- Usage    : SELECT get_posts_meta(ARRAY[...], '<user_id>'::uuid);
-- Notes    :
--   - If p_user_id is NULL, user_liked will be an empty array []
--   - Only counts comments where is_deleted = false
--   - Respects existing RLS policies (SECURITY INVOKER)
--   - Grants EXECUTE to anon/authenticated roles
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_posts_meta(uuid[], uuid);

CREATE OR REPLACE FUNCTION public.get_posts_meta(
  p_post_ids uuid[],
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_comments jsonb := '{}'::jsonb;
  v_user_liked jsonb := '[]'::jsonb;
BEGIN
  -- Build comment count map per post_id
  SELECT COALESCE(jsonb_object_agg(t.post_id, t.cnt), '{}'::jsonb)
    INTO v_comments
  FROM (
    SELECT c.post_id, COUNT(*)::int AS cnt
    FROM public.comments c
    WHERE c.post_id = ANY(p_post_ids)
      AND c.is_deleted = FALSE
    GROUP BY c.post_id
  ) AS t;

  -- Build user liked post_id array (if user provided)
  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(pl.post_id), '[]'::jsonb)
      INTO v_user_liked
    FROM (
      SELECT DISTINCT l.post_id
      FROM public.post_likes l
      WHERE l.post_id = ANY(p_post_ids)
        AND l.user_id = p_user_id
    ) AS pl;
  END IF;

  RETURN jsonb_build_object(
    'comments', v_comments,
    'user_liked', v_user_liked
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_posts_meta(uuid[], uuid) TO anon, authenticated;

