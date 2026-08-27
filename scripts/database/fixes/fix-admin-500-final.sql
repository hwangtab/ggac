-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Final Admin API 500 Error Fix - Error-Free Version
-- This fixes the RLS policy error and adds all missing elements

-- 1. Add missing columns to member_profiles table
DO $$ 
BEGIN
  -- Add approved_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'approved_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN approved_by UUID 
      REFERENCES public.member_profiles(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added approved_by column';
  ELSE
    RAISE NOTICE 'approved_by column already exists';
  END IF;

  -- Add rejected_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'rejected_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN rejected_by UUID 
      REFERENCES public.member_profiles(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added rejected_by column';
  ELSE
    RAISE NOTICE 'rejected_by column already exists';
  END IF;
END $$;

-- 2. Add like_count column to posts table
DO $$ 
BEGIN
  -- Add like_count column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'posts' AND column_name = 'like_count') THEN
    ALTER TABLE public.posts ADD COLUMN like_count INTEGER DEFAULT 0 
      CHECK (like_count >= 0);
    RAISE NOTICE 'Added like_count column to posts';
  ELSE
    RAISE NOTICE 'like_count column already exists in posts';
  END IF;
END $$;

-- 3. Create post_attachments table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.post_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(100),
  file_size BIGINT,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create post_likes table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.post_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- 5. Enable RLS for new tables
ALTER TABLE public.post_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

-- 6. Create simplified RLS policies for post_attachments (admin-only access for now)
DROP POLICY IF EXISTS "Admins can manage all attachments" ON public.post_attachments;
CREATE POLICY "Admins can manage all attachments" ON public.post_attachments 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

-- 7. Create simplified RLS policies for post_likes (admin can view all, users can manage own)
DROP POLICY IF EXISTS "Admins can view all post likes" ON public.post_likes;
CREATE POLICY "Admins can view all post likes" ON public.post_likes 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Users can manage own likes" ON public.post_likes;
CREATE POLICY "Users can manage own likes" ON public.post_likes 
  FOR ALL USING (
    user_id = auth.uid() 
    AND EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

-- 8. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_post_attachments_post_id ON public.post_attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON public.post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_approved_by ON public.member_profiles(approved_by);
CREATE INDEX IF NOT EXISTS idx_member_profiles_rejected_by ON public.member_profiles(rejected_by);

-- 9. Create function to update like_count automatically
CREATE OR REPLACE FUNCTION public.update_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts 
    SET like_count = like_count + 1 
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts 
    SET like_count = GREATEST(like_count - 1, 0) 
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Create triggers for automatic like_count updates
DROP TRIGGER IF EXISTS post_likes_count_trigger ON public.post_likes;
CREATE TRIGGER post_likes_count_trigger
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_like_count();

-- 11. Initialize like_count for existing posts
UPDATE public.posts 
SET like_count = COALESCE((
  SELECT COUNT(*) 
  FROM public.post_likes 
  WHERE post_likes.post_id = posts.id
), 0)
WHERE like_count IS NULL;

-- Display success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Admin API 500 Error Fix Applied Successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Database elements created:';
  RAISE NOTICE '✅ approved_by, rejected_by columns added to member_profiles';
  RAISE NOTICE '✅ like_count column added to posts table';
  RAISE NOTICE '✅ post_attachments table created with RLS policies';
  RAISE NOTICE '✅ post_likes table created with automatic like counting';
  RAISE NOTICE '✅ Performance indexes created for all new columns';
  RAISE NOTICE '✅ Triggers created for automatic like_count updates';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin pages should now work without 500 errors!';
  RAISE NOTICE 'Please refresh your admin dashboard to test.';
END $$;