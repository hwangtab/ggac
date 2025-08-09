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