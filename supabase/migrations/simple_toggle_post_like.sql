-- 좋아요 토글 함수 간단화 버전
-- 복잡한 락킹과 트랜잭션 로직 제거, UPSERT 패턴 사용

-- 기존 함수 교체
CREATE OR REPLACE FUNCTION toggle_post_like(
  p_post_id UUID,
  p_user_id UUID
) 
RETURNS TABLE(
  liked BOOLEAN,
  like_count INTEGER
) AS $$
DECLARE
  existing_like_id UUID;
  current_like_count INTEGER;
  is_liked BOOLEAN := false;
BEGIN
  -- 게시글 존재 확인
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND is_deleted = false) THEN
    RAISE EXCEPTION 'Post not found or deleted';
  END IF;
  
  -- 기존 좋아요 확인
  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    -- 좋아요가 있으면 삭제 (취소)
    DELETE FROM post_likes WHERE id = existing_like_id;
    is_liked := false;
  ELSE
    -- 좋아요가 없으면 추가
    INSERT INTO post_likes (post_id, user_id)
    VALUES (p_post_id, p_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;
    is_liked := true;
  END IF;
  
  -- 현재 좋아요 수 조회
  SELECT like_count INTO current_like_count
  FROM posts WHERE id = p_post_id;
  
  RETURN QUERY SELECT is_liked, COALESCE(current_like_count, 0);
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 실행 권한 설정
REVOKE ALL ON FUNCTION toggle_post_like FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_post_like TO authenticated;