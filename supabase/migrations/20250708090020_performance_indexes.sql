-- Performance optimization indexes for GGAC website
-- Phase 3: Database performance improvements

-- Posts table indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_created_at_desc 
ON public.posts(created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_category_created_at 
ON public.posts(category, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_author_id 
ON public.posts(author_id) 
WHERE is_deleted = false;

-- Comments table indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_post_id_created_at 
ON public.comments(post_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_author_id 
ON public.comments(author_id);

-- Member profiles indexes for better authentication performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_email 
ON public.member_profiles(email);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_registration_status_active 
ON public.member_profiles(registration_status, is_active) 
WHERE registration_status IN ('approved', 'pending');

-- Composite index for board page performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_category_author_created 
ON public.posts(category, author_id, created_at DESC) 
WHERE is_deleted = false;

-- Index for admin dashboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_created_at 
ON public.member_profiles(created_at DESC);

-- Comments count optimization (for posts with comments)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_post_count 
ON public.comments(post_id) 
INCLUDE (created_at);