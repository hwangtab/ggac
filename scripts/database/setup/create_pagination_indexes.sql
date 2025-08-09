-- 페이지네이션 성능 최적화를 위한 인덱스 생성
-- 실행 방법: Supabase Dashboard > SQL Editor에서 실행

-- 1. 카테고리별 + 생성일 기준 정렬 최적화
-- (카테고리 필터링 + 최신순 정렬에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_category_created_at 
ON posts(category, created_at DESC) 
WHERE is_deleted = false;

-- 2. 전체 게시글 최신순 조회 최적화
-- (기본 게시판 목록 조회에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_created_at_active 
ON posts(created_at DESC) 
WHERE is_deleted = false;

-- 3. 공지사항 우선 정렬 최적화
-- (공지 + 일반글 분리 조회에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_category_priority 
ON posts(
  (CASE WHEN category = '공지' THEN 0 ELSE 1 END),
  created_at DESC
) 
WHERE is_deleted = false;

-- 4. 작성자 기준 게시글 조회 최적화 (향후 마이페이지용)
CREATE INDEX IF NOT EXISTS idx_posts_author_created_at 
ON posts(author_id, created_at DESC) 
WHERE is_deleted = false;

-- 인덱스 생성 확인
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'posts' 
AND indexname LIKE 'idx_posts_%'
ORDER BY indexname;