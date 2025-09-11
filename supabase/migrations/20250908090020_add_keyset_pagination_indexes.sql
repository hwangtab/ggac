-- 키셋 페이지네이션 성능 최적화를 위한 복합 인덱스 추가
-- Created: 2025-09-08
-- Purpose: 게시판 성능 최적화 - 키셋 페이지네이션 지원

-- 1. 게시글 목록 조회를 위한 복합 인덱스 (is_pinned, created_at, id)
-- 고정 게시글을 먼저 보여주고, 그 다음 생성일 순으로 정렬하기 위함
CREATE INDEX IF NOT EXISTS idx_posts_keyset_pagination 
ON posts (is_pinned DESC, created_at DESC, id DESC)
WHERE (is_deleted = false OR is_deleted IS NULL);

-- 2. 카테고리별 게시글 조회를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_category_keyset_pagination 
ON posts (category, is_pinned DESC, created_at DESC, id DESC)
WHERE (is_deleted = false OR is_deleted IS NULL);

-- 3. 댓글 조회 최적화를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_comments_post_keyset_pagination 
ON comments (post_id, created_at DESC, id DESC)
WHERE is_deleted = false;

-- 4. 게시글 좋아요 조회 최적화 (N+1 해결)
CREATE INDEX IF NOT EXISTS idx_post_likes_post_user 
ON post_likes (post_id, user_id);

-- 5. 댓글 좋아요 조회 최적화 (N+1 해결)
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_user 
ON comment_likes (comment_id, user_id);

-- 6. 첨부파일 조회 최적화 (N+1 해결)
CREATE INDEX IF NOT EXISTS idx_post_attachments_post_type 
ON post_attachments (post_id, file_type);

-- 7. 작성자 정보 조회 최적화
CREATE INDEX IF NOT EXISTS idx_member_profiles_display_name 
ON member_profiles (id, display_name, registration_status, is_active)
WHERE registration_status = 'approved' AND is_active = true;

-- 8. 검색 성능 향상을 위한 GIN 인덱스 (전문 검색)
-- 제목과 내용에서의 텍스트 검색 성능 향상
CREATE INDEX IF NOT EXISTS idx_posts_search_gin 
ON posts USING gin(to_tsvector('korean', title || ' ' || content))
WHERE (is_deleted = false OR is_deleted IS NULL);

-- 9. 알림 시스템 최적화를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_user_read 
ON notifications (user_id, is_read, created_at DESC)
WHERE is_read = false;

-- 10. 활동 로그 최적화를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time 
ON activity_logs (user_id, created_at DESC)
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days';

-- 성능 통계 업데이트 (선택사항)
-- 새로 생성된 인덱스에 대한 통계 수집
ANALYZE posts;
ANALYZE comments; 
ANALYZE post_likes;
ANALYZE comment_likes;
ANALYZE post_attachments;
ANALYZE member_profiles;
ANALYZE notifications;
ANALYZE activity_logs;

-- 마이그레이션 완료 로그
INSERT INTO activity_logs (
  activity_type,
  description,
  metadata,
  created_at
) VALUES (
  'system',
  'Database indexes optimized for keyset pagination',
  jsonb_build_object(
    'migration', '20250908_add_keyset_pagination_indexes',
    'indexes_created', 10,
    'performance_improvement', 'keyset_pagination'
  ),
  NOW()
);

-- 인덱스 생성 결과 확인 쿼리 (실행하여 확인)
-- SELECT 
--   indexname,
--   indexdef
-- FROM pg_indexes 
-- WHERE tablename IN ('posts', 'comments', 'post_likes', 'comment_likes', 'post_attachments', 'member_profiles')
--   AND indexname LIKE '%keyset%'
-- ORDER BY tablename, indexname;