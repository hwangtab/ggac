-- Migration: Optimize posts performance with indexes and query improvements
-- Date: 2025-09-03
-- Purpose: Add composite indexes to improve board loading performance

-- 1. 복합 인덱스: 게시글 조회 최적화
-- posts 테이블의 주요 조회 패턴에 최적화된 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_posts_optimized_list 
ON posts (is_deleted, category, is_pinned DESC, created_at DESC)
WHERE is_deleted = false;

-- 2. 좋아요 관련 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_post_likes_optimized 
ON post_likes (post_id, user_id);

-- 3. 댓글 수 조회 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_comments_post_count 
ON comments (post_id);

-- 4. 게시글별 좋아요 수 계산을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_post_likes_count 
ON post_likes (post_id);

-- 5. 작성자 정보 조회 최적화
CREATE INDEX IF NOT EXISTS idx_member_profiles_author_info 
ON member_profiles (id, display_name, email, registration_status)
WHERE registration_status = 'approved';

-- 6. 성능 분석을 위한 통계 업데이트
ANALYZE posts;
ANALYZE post_likes;
ANALYZE comments;
ANALYZE member_profiles;

-- 인덱스 정보 확인용 뷰 생성 (선택사항)
CREATE OR REPLACE VIEW posts_performance_indexes AS
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('posts', 'post_likes', 'comments', 'member_profiles')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- 권한 부여
GRANT SELECT ON posts_performance_indexes TO authenticated;

COMMENT ON INDEX idx_posts_optimized_list IS '게시글 목록 조회 성능 최적화를 위한 복합 인덱스';
COMMENT ON INDEX idx_post_likes_optimized IS '사용자별 좋아요 상태 확인 최적화 인덱스';
COMMENT ON INDEX idx_comments_post_count IS '게시글별 댓글 수 집계 최적화 인덱스';
COMMENT ON INDEX idx_post_likes_count IS '게시글별 좋아요 수 집계 최적화 인덱스';
COMMENT ON INDEX idx_member_profiles_author_info IS '작성자 정보 조회 최적화 인덱스';