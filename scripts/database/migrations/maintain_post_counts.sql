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
-- Denormalized counts on posts: comment_count and like_count maintenance
-- This migration adds/ensures columns and creates triggers to keep them in sync.
-- Safe to run multiple times.
-- ============================================================================

-- 1) Columns
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0;

-- like_count column is assumed to exist; ensure not null default
ALTER TABLE public.posts
  ALTER COLUMN like_count SET DEFAULT 0,
  ALTER COLUMN like_count SET NOT NULL;

-- 2) Helper functions (SECURITY DEFINER for consistent rights)
DROP FUNCTION IF EXISTS public.recalc_post_comment_count(uuid);
CREATE OR REPLACE FUNCTION public.recalc_post_comment_count(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_is_deleted boolean;
BEGIN
  -- Detect presence of is_deleted column on comments table (for portability)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comments'
      AND column_name = 'is_deleted'
  ) INTO has_is_deleted;

  IF has_is_deleted THEN
    UPDATE public.posts p
    SET comment_count = (
      SELECT COUNT(1)
      FROM public.comments c
      WHERE c.post_id = p.id AND c.is_deleted = FALSE
    )
    WHERE p.id = p_post_id;
  ELSE
    UPDATE public.posts p
    SET comment_count = (
      SELECT COUNT(1)
      FROM public.comments c
      WHERE c.post_id = p.id
    )
    WHERE p.id = p_post_id;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.recalc_post_like_count(uuid);
CREATE OR REPLACE FUNCTION public.recalc_post_like_count(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts p
  SET like_count = (
    SELECT COUNT(1)
    FROM public.post_likes l
    WHERE l.post_id = p.id
  )
  WHERE p.id = p_post_id;
END;
$$;

-- Unified trigger function for comments table
DROP FUNCTION IF EXISTS public.trg_comments_recalc() CASCADE;
CREATE OR REPLACE FUNCTION public.trg_comments_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalc_post_comment_count(NEW.post_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_post_comment_count(OLD.post_id);
  ELSIF TG_OP = 'UPDATE' THEN
    -- handle is_deleted or post_id change
    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      PERFORM public.recalc_post_comment_count(OLD.post_id);
    END IF;
    PERFORM public.recalc_post_comment_count(COALESCE(NEW.post_id, OLD.post_id));
  END IF;
  RETURN NULL;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_comments_recalc_counts'
  ) THEN
    CREATE TRIGGER trg_comments_recalc_counts
    AFTER INSERT OR DELETE OR UPDATE ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.trg_comments_recalc();
  END IF;
END $$;

-- Unified trigger function for post_likes table
DROP FUNCTION IF EXISTS public.trg_post_likes_recalc() CASCADE;
CREATE OR REPLACE FUNCTION public.trg_post_likes_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalc_post_like_count(NEW.post_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_post_like_count(OLD.post_id);
  END IF;
  RETURN NULL;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_likes_recalc_count'
  ) THEN
    CREATE TRIGGER trg_likes_recalc_count
    AFTER INSERT OR DELETE ON public.post_likes
    FOR EACH ROW EXECUTE FUNCTION public.trg_post_likes_recalc();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'is_deleted'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_comments_post_id_is_deleted ON public.comments (post_id, is_deleted);
  ELSE
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON public.comments (post_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id_user_id ON public.post_likes (post_id, user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'is_deleted'
  ) THEN
    UPDATE public.posts p
    SET comment_count = (
      SELECT COUNT(1) FROM public.comments c WHERE c.post_id = p.id AND c.is_deleted = FALSE
    );
  ELSE
    UPDATE public.posts p
    SET comment_count = (
      SELECT COUNT(1) FROM public.comments c WHERE c.post_id = p.id
    );
  END IF;
END $$;

UPDATE public.posts p
SET like_count = (
  SELECT COUNT(1) FROM public.post_likes l WHERE l.post_id = p.id
);
