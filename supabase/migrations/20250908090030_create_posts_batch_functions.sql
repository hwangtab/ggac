-- N+1 쿼리 해결을 위한 배치 처리 RPC 함수들
-- Created: 2025-09-08
-- Purpose: 게시글 목록 조회 시 한 번의 호출로 모든 메타데이터 가져오기

-- 1. 게시글 메타데이터 배치 조회 함수
CREATE OR REPLACE FUNCTION get_posts_meta(
  p_post_ids UUID[],
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  comments_data JSONB := '{}';
  user_liked_data UUID[] := '{}';
  result JSONB;
BEGIN
  -- 댓글 수 조회 (post_id별로 집계)
  WITH comment_counts AS (
    SELECT 
      post_id,
      COUNT(*) as count
    FROM comments 
    WHERE post_id = ANY(p_post_ids)
      AND is_deleted = false
    GROUP BY post_id
  )
  SELECT jsonb_object_agg(post_id::text, count)
  INTO comments_data
  FROM comment_counts;
  
  -- 사용자 좋아요 목록 조회 (사용자가 로그인한 경우만)
  IF p_user_id IS NOT NULL THEN
    SELECT array_agg(post_id)
    INTO user_liked_data
    FROM post_likes 
    WHERE post_id = ANY(p_post_ids)
      AND user_id = p_user_id;
  END IF;
  
  -- 결과 조합
  result := jsonb_build_object(
    'comments', COALESCE(comments_data, '{}'),
    'user_liked', COALESCE(user_liked_data, '{}')
  );
  
  RETURN result;
END;
$$;

-- 2. 댓글 메타데이터 배치 조회 함수 (댓글 목록용)
CREATE OR REPLACE FUNCTION get_comments_meta(
  p_comment_ids UUID[],
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_liked_comments UUID[] := '{}';
  result JSONB;
BEGIN
  -- 사용자가 좋아요한 댓글 목록 조회
  IF p_user_id IS NOT NULL THEN
    SELECT array_agg(comment_id)
    INTO user_liked_comments
    FROM comment_likes 
    WHERE comment_id = ANY(p_comment_ids)
      AND user_id = p_user_id;
  END IF;
  
  result := jsonb_build_object(
    'user_liked_comments', COALESCE(user_liked_comments, '{}')
  );
  
  RETURN result;
END;
$$;

-- 3. 첨부파일 통계 배치 조회 함수
CREATE OR REPLACE FUNCTION get_posts_attachment_stats(
  p_post_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  attachment_stats JSONB := '{}';
BEGIN
  WITH attachment_counts AS (
    SELECT 
      post_id,
      COUNT(*) as total_attachments,
      COUNT(*) FILTER (WHERE file_type = 'image') as image_count,
      COUNT(*) FILTER (WHERE file_type = 'document') as document_count,
      COUNT(*) FILTER (WHERE file_type = 'video') as video_count,
      COUNT(*) FILTER (WHERE file_type = 'audio') as audio_count
    FROM post_attachments
    WHERE post_id = ANY(p_post_ids)
    GROUP BY post_id
  )
  SELECT jsonb_object_agg(
    post_id::text,
    jsonb_build_object(
      'total_attachments', total_attachments,
      'image_count', image_count,
      'document_count', document_count,
      'video_count', video_count,
      'audio_count', audio_count
    )
  )
  INTO attachment_stats
  FROM attachment_counts;
  
  RETURN COALESCE(attachment_stats, '{}');
END;
$$;

-- 4. 통합 게시글 메타데이터 조회 함수 (모든 것을 한 번에)
CREATE OR REPLACE FUNCTION get_posts_complete_meta(
  p_post_ids UUID[],
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  posts_meta JSONB;
  attachments_meta JSONB;
  result JSONB;
BEGIN
  -- 기본 메타데이터 조회
  SELECT get_posts_meta(p_post_ids, p_user_id) INTO posts_meta;
  
  -- 첨부파일 통계 조회
  SELECT get_posts_attachment_stats(p_post_ids) INTO attachments_meta;
  
  -- 결과 병합
  result := jsonb_build_object(
    'comments', posts_meta->'comments',
    'user_liked', posts_meta->'user_liked',
    'attachments', attachments_meta
  );
  
  RETURN result;
END;
$$;

-- 5. 카운터 업데이트를 위한 트리거 함수들
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts 
    SET comment_count = comment_count + 1,
        updated_at = NOW()
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts 
    SET comment_count = GREATEST(comment_count - 1, 0),
        updated_at = NOW()
    WHERE id = OLD.post_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- is_deleted 상태가 변경된 경우
    IF OLD.is_deleted != NEW.is_deleted THEN
      IF NEW.is_deleted = true THEN
        UPDATE posts 
        SET comment_count = GREATEST(comment_count - 1, 0),
            updated_at = NOW()
        WHERE id = NEW.post_id;
      ELSE
        UPDATE posts 
        SET comment_count = comment_count + 1,
            updated_at = NOW()
        WHERE id = NEW.post_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- 댓글 수 자동 업데이트 트리거
DROP TRIGGER IF EXISTS trigger_update_post_comment_count ON comments;
CREATE TRIGGER trigger_update_post_comment_count
  AFTER INSERT OR UPDATE OR DELETE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comment_count();

-- 6. 좋아요 수 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts 
    SET like_count = like_count + 1,
        updated_at = NOW()
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts 
    SET like_count = GREATEST(like_count - 1, 0),
        updated_at = NOW()
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 좋아요 수 자동 업데이트 트리거
DROP TRIGGER IF EXISTS trigger_update_post_like_count ON post_likes;
CREATE TRIGGER trigger_update_post_like_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_like_count();

-- 권한 설정 - authenticated 사용자에게 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_posts_meta(UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comments_meta(UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_posts_attachment_stats(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_posts_complete_meta(UUID[], UUID) TO authenticated;

-- 익명 사용자에게도 읽기 전용 함수 권한 부여 (p_user_id는 NULL로)
GRANT EXECUTE ON FUNCTION get_posts_meta(UUID[], UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_posts_attachment_stats(UUID[]) TO anon;
GRANT EXECUTE ON FUNCTION get_posts_complete_meta(UUID[], UUID) TO anon;

-- 마이그레이션 로그
INSERT INTO activity_logs (
  activity_type,
  description,
  metadata,
  created_at
) VALUES (
  'system',
  'Batch processing RPC functions created for N+1 query optimization',
  jsonb_build_object(
    'migration', '20250908_create_posts_batch_functions',
    'functions_created', array['get_posts_meta', 'get_comments_meta', 'get_posts_attachment_stats', 'get_posts_complete_meta'],
    'triggers_created', array['update_post_comment_count', 'update_post_like_count'],
    'performance_improvement', 'n_plus_one_elimination'
  ),
  NOW()
);

-- 함수 생성 확인 쿼리 (실행하여 확인)
-- SELECT 
--   routine_name,
--   routine_type,
--   specific_name
-- FROM information_schema.routines 
-- WHERE routine_schema = 'public' 
--   AND routine_name LIKE '%posts%meta%'
-- ORDER BY routine_name;