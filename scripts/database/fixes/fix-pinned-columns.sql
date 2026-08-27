-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Fix Missing Pinned Columns in posts Table
-- This adds the exact missing columns that cause 500 errors

-- Add is_pinned and pinned_at columns to posts table
DO $$ 
BEGIN
  -- Add is_pinned column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'posts' AND column_name = 'is_pinned') THEN
    ALTER TABLE public.posts ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Added is_pinned column to posts table';
  ELSE
    RAISE NOTICE 'is_pinned column already exists in posts table';
  END IF;

  -- Add pinned_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'posts' AND column_name = 'pinned_at') THEN
    ALTER TABLE public.posts ADD COLUMN pinned_at TIMESTAMP WITH TIME ZONE;
    RAISE NOTICE 'Added pinned_at column to posts table';
  ELSE
    RAISE NOTICE 'pinned_at column already exists in posts table';
  END IF;

  -- Add like_count column if it doesn't exist (from previous fix)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'posts' AND column_name = 'like_count') THEN
    ALTER TABLE public.posts ADD COLUMN like_count INTEGER DEFAULT 0 
      CHECK (like_count >= 0);
    RAISE NOTICE 'Added like_count column to posts table';
  ELSE
    RAISE NOTICE 'like_count column already exists in posts table';
  END IF;
END $$;

-- Update existing posts to have proper defaults
UPDATE public.posts 
SET 
  is_pinned = COALESCE(is_pinned, FALSE),
  like_count = COALESCE(like_count, 0)
WHERE 
  is_pinned IS NULL 
  OR like_count IS NULL;

-- Create index for pinned posts performance
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON public.posts(is_pinned, pinned_at DESC);

-- Display success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Fixed posts table schema!';
  RAISE NOTICE '';
  RAISE NOTICE '✅ is_pinned column added to posts table';
  RAISE NOTICE '✅ pinned_at column added to posts table';
  RAISE NOTICE '✅ like_count column added to posts table';
  RAISE NOTICE '✅ Performance index created for pinned posts';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin posts API should now work completely!';
END $$;