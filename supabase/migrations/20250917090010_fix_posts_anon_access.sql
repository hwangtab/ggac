-- Ensure anon/public can read posts/comments/attachments under RLS
-- Idempotent-ish: drop conflicting policies if they exist, then recreate permissive read policies.

-- posts
ALTER TABLE IF EXISTS public.posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;
CREATE POLICY "Anyone can view posts" ON public.posts
  FOR SELECT TO anon
  USING (is_deleted = false);
GRANT SELECT ON public.posts TO anon;

-- comments
ALTER TABLE IF EXISTS public.comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view comments" ON public.comments;
CREATE POLICY "Anyone can view comments" ON public.comments
  FOR SELECT TO anon
  USING (true);
GRANT SELECT ON public.comments TO anon;

-- post_attachments
ALTER TABLE IF EXISTS public.post_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view attachments" ON public.post_attachments;
CREATE POLICY "Anyone can view attachments" ON public.post_attachments
  FOR SELECT TO anon
  USING (true);
GRANT SELECT ON public.post_attachments TO anon;

DO $$
BEGIN
  RAISE NOTICE '✅ Fixed anon read access for posts/comments/attachments under RLS';
END $$;

