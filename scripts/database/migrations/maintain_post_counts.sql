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
BEGIN
  UPDATE public.posts p
  SET comment_count = (
    SELECT COUNT(1)
    FROM public.comments c
    WHERE c.post_id = p.id AND c.is_deleted = FALSE
  )
  WHERE p.id = p_post_id;
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

-- 3) Triggers on comments (insert/delete/update is_deleted)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_comments_after_insert_recalc_count'
  ) THEN
    CREATE TRIGGER trg_comments_after_insert_recalc_count
    AFTER INSERT ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.recalc_post_comment_count(NEW.post_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_comments_after_delete_recalc_count'
  ) THEN
    CREATE TRIGGER trg_comments_after_delete_recalc_count
    AFTER DELETE ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.recalc_post_comment_count(OLD.post_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_comments_after_update_recalc_count'
  ) THEN
    CREATE TRIGGER trg_comments_after_update_recalc_count
    AFTER UPDATE OF is_deleted ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.recalc_post_comment_count(NEW.post_id);
  END IF;
END $$;

-- 4) Triggers on post_likes (insert/delete)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_likes_after_insert_recalc_count'
  ) THEN
    CREATE TRIGGER trg_likes_after_insert_recalc_count
    AFTER INSERT ON public.post_likes
    FOR EACH ROW EXECUTE FUNCTION public.recalc_post_like_count(NEW.post_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_likes_after_delete_recalc_count'
  ) THEN
    CREATE TRIGGER trg_likes_after_delete_recalc_count
    AFTER DELETE ON public.post_likes
    FOR EACH ROW EXECUTE FUNCTION public.recalc_post_like_count(OLD.post_id);
  END IF;
END $$;

-- 5) Helpful indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_comments_post_id_is_deleted ON public.comments (post_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id_user_id ON public.post_likes (post_id, user_id);

-- 6) Backfill counts once
UPDATE public.posts p
SET comment_count = (
  SELECT COUNT(1) FROM public.comments c WHERE c.post_id = p.id AND c.is_deleted = FALSE
);

UPDATE public.posts p
SET like_count = (
  SELECT COUNT(1) FROM public.post_likes l WHERE l.post_id = p.id
);

