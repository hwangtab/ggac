-- Complete Admin API 500 Error Fix - Part 2
-- This adds the remaining missing columns and tables that cause 500 errors

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
  uploaded_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create post_likes table if it doesn't exist (for future like_count calculation)
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

-- 6. Create RLS policies for post_attachments
DROP POLICY IF EXISTS "Posts attachments are viewable by members" ON public.post_attachments;
CREATE POLICY "Posts attachments are viewable by members" ON public.post_attachments 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

DROP POLICY IF EXISTS "Users can manage own post attachments" ON public.post_attachments;
CREATE POLICY "Users can manage own post attachments" ON public.post_attachments 
  FOR ALL USING (uploaded_by = auth.uid());

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

-- 7. Create RLS policies for post_likes
DROP POLICY IF EXISTS "Users can view all post likes" ON public.post_likes;
CREATE POLICY "Users can view all post likes" ON public.post_likes 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

DROP POLICY IF EXISTS "Users can manage own likes" ON public.post_likes;
CREATE POLICY "Users can manage own likes" ON public.post_likes 
  FOR ALL USING (user_id = auth.uid());

-- 8. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_post_attachments_post_id ON public.post_attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_attachments_uploaded_by ON public.post_attachments(uploaded_by);
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
SET like_count = (
  SELECT COUNT(*) 
  FROM public.post_likes 
  WHERE post_likes.post_id = posts.id
)
WHERE like_count IS NULL OR like_count = 0;

-- Display what was created
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Complete Admin API 500 Error Fix Applied!';
  RAISE NOTICE '';
  RAISE NOTICE 'Added missing database elements:';
  RAISE NOTICE '- approved_by, rejected_by columns to member_profiles';
  RAISE NOTICE '- like_count column to posts table';
  RAISE NOTICE '- post_attachments table with RLS policies';
  RAISE NOTICE '- post_likes table with automatic like_count updates';
  RAISE NOTICE '- Performance indexes for all new columns';
  RAISE NOTICE '- Triggers for automatic like counting';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin APIs should now work completely without 500 errors!';
END $$;