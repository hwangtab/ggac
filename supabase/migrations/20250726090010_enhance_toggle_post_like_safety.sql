-- 좋아요 토글 함수 안전성 강화
-- 동시 실행 시 중복 처리 방지를 위한 트랜잭션 격리 및 락 메커니즘 적용

-- 기존 함수 대체 (트랜잭션 안전성 강화)
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
  is_post_deleted BOOLEAN := false;
BEGIN
  -- 명시적 트랜잭션 시작 및 격리 수준 설정 (SERIALIZABLE로 최고 수준 보장)
  -- 하지만 SERIALIZABLE은 성능에 영향을 줄 수 있으므로 REPEATABLE READ 사용
  SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  
  -- 게시글 존재 여부 및 삭제 상태 확인 (행 단위 락)
  SELECT is_deleted INTO is_post_deleted
  FROM posts 
  WHERE id = p_post_id
  FOR UPDATE; -- 해당 게시글 행에 락 설정
  
  -- 게시글이 없거나 삭제된 경우 예외 처리
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  
  IF is_post_deleted THEN
    RAISE EXCEPTION 'POST_DELETED' USING ERRCODE = 'P0002';
  END IF;
  
  -- 기존 좋아요 확인 (행 단위 락 - 동시 실행 방지)
  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id
  FOR UPDATE; -- 해당 좋아요 행에 락 설정 (있다면)

  IF existing_like_id IS NOT NULL THEN
    -- 좋아요가 이미 있으면 삭제 (취소)
    DELETE FROM post_likes WHERE id = existing_like_id;
    
    -- 트리거가 like_count를 자동 업데이트하므로 대기 후 조회
    SELECT like_count INTO current_like_count
    FROM posts WHERE id = p_post_id;
    
    -- 로그 남기기 (중복 체크용)
    RAISE LOG 'toggle_post_like: 좋아요 취소 - 사용자: %, 게시글: %, 현재 카운트: %', p_user_id, p_post_id, current_like_count;
    
    RETURN QUERY SELECT false, current_like_count;
  ELSE
    -- 중복 삽입 방지를 위한 추가 체크 (Race Condition 대응)
    BEGIN
      -- 좋아요 추가 (UNIQUE 제약 조건으로 중복 방지)
      INSERT INTO post_likes (post_id, user_id)
      VALUES (p_post_id, p_user_id);
      
      -- 트리거가 like_count를 자동 업데이트하므로 대기 후 조회
      SELECT like_count INTO current_like_count
      FROM posts WHERE id = p_post_id;
      
      -- 로그 남기기 (중복 체크용)
      RAISE LOG 'toggle_post_like: 좋아요 추가 - 사용자: %, 게시글: %, 현재 카운트: %', p_user_id, p_post_id, current_like_count;
      
      RETURN QUERY SELECT true, current_like_count;
      
    EXCEPTION
      WHEN unique_violation THEN
        -- 동시 실행으로 인한 중복 삽입 시도 시, 다시 삭제 로직 실행
        RAISE LOG 'toggle_post_like: 중복 삽입 감지, 삭제로 전환 - 사용자: %, 게시글: %', p_user_id, p_post_id;
        
        -- 다시 좋아요 찾아서 삭제
        SELECT id INTO existing_like_id
        FROM post_likes
        WHERE post_id = p_post_id AND user_id = p_user_id
        FOR UPDATE;
        
        IF existing_like_id IS NOT NULL THEN
          DELETE FROM post_likes WHERE id = existing_like_id;
          
          SELECT like_count INTO current_like_count
          FROM posts WHERE id = p_post_id;
          
          RETURN QUERY SELECT false, current_like_count;
        ELSE
          -- 이론적으로 발생하지 않아야 하는 상황
          RAISE EXCEPTION 'UNEXPECTED_STATE' USING ERRCODE = 'P0003';
        END IF;
    END;
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    -- 모든 예외를 상위로 전파
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 실행 권한 설정 (보안 강화)
REVOKE ALL ON FUNCTION toggle_post_like FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_post_like TO authenticated;

-- 성능 최적화를 위한 추가 인덱스 (동시성 개선)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_post_likes_user_post_unique 
ON post_likes (user_id, post_id);

-- 게시글별 좋아요 개수 정확성 검증 함수 (디버깅용)
CREATE OR REPLACE FUNCTION verify_post_like_counts()
RETURNS TABLE(
  post_id UUID,
  actual_count BIGINT,
  stored_count INTEGER,
  is_correct BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as post_id,
    COALESCE(pl_count.cnt, 0) as actual_count,
    p.like_count as stored_count,
    (COALESCE(pl_count.cnt, 0) = p.like_count) as is_correct
  FROM posts p
  LEFT JOIN (
    SELECT post_id, COUNT(*) as cnt
    FROM post_likes
    GROUP BY post_id
  ) pl_count ON p.id = pl_count.post_id
  WHERE p.is_deleted = false
  ORDER BY p.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 좋아요 수 불일치 수정 함수 (관리자용)
CREATE OR REPLACE FUNCTION fix_post_like_counts()
RETURNS INTEGER AS $$
DECLARE
  fixed_count INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT 
      p.id as post_id,
      COALESCE(pl_count.cnt, 0) as actual_count,
      p.like_count as stored_count
    FROM posts p
    LEFT JOIN (
      SELECT post_id, COUNT(*) as cnt
      FROM post_likes
      GROUP BY post_id
    ) pl_count ON p.id = pl_count.post_id
    WHERE COALESCE(pl_count.cnt, 0) != p.like_count
  LOOP
    UPDATE posts 
    SET like_count = rec.actual_count
    WHERE id = rec.post_id;
    
    fixed_count := fixed_count + 1;
    
    RAISE LOG 'fix_post_like_counts: 게시글 % 좋아요 수 수정 - % -> %', 
      rec.post_id, rec.stored_count, rec.actual_count;
  END LOOP;
  
  RETURN fixed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 댓글 추가
COMMENT ON FUNCTION toggle_post_like IS '게시글 좋아요 토글 (트랜잭션 안전성 강화 버전)';
COMMENT ON FUNCTION verify_post_like_counts IS '게시글 좋아요 개수 정확성 검증';
COMMENT ON FUNCTION fix_post_like_counts IS '좋아요 수 불일치 수정 (관리자용)';