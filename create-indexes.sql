-- Database Indexes for Pagination Optimization
-- Execute this script in the Supabase Dashboard SQL Editor

-- 1. 카테고리별 + 생성일 기준 정렬 최적화
CREATE INDEX IF NOT EXISTS idx_posts_category_created_at 
ON posts(category, created_at DESC) 
WHERE is_deleted = false;

-- 2. 전체 게시글 최신순 조회 최적화
CREATE INDEX IF NOT EXISTS idx_posts_created_at_active 
ON posts(created_at DESC) 
WHERE is_deleted = false;

-- 3. 공지사항 우선 정렬 최적화
CREATE INDEX IF NOT EXISTS idx_posts_category_priority 
ON posts(
  (CASE WHEN category = '공지' THEN 0 ELSE 1 END),
  created_at DESC
) 
WHERE is_deleted = false;

-- 4. 작성자 기준 게시글 조회 최적화
CREATE INDEX IF NOT EXISTS idx_posts_author_created_at 
ON posts(author_id, created_at DESC) 
WHERE is_deleted = false;

-- Verification query - run this after creating the indexes
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'posts' 
AND indexname LIKE 'idx_posts_%'
ORDER BY indexname;