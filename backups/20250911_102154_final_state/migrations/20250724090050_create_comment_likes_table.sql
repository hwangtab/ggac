-- 댓글 좋아요/추천 시스템 테이블 생성
-- 사용자가 댓글에 좋아요를 누를 수 있는 시스템

-- 댓글 좋아요 테이블
CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 한 사용자가 하나의 댓글에 중복 좋아요 방지
  UNIQUE(comment_id, user_id)
);

-- 댓글 좋아요 통계 컬럼 추가 (comments 테이블에)
ALTER TABLE comments 
ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_like_count ON comments(like_count);

-- RLS 정책 설정
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자는 좋아요 목록을 조회할 수 있음
CREATE POLICY "Anyone can view comment likes" ON comment_likes
  FOR SELECT USING (true);

-- 인증된 사용자는 자신의 좋아요를 생성할 수 있음
CREATE POLICY "Users can create their own comment likes" ON comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 인증된 사용자는 자신의 좋아요를 삭제할 수 있음 (취소)
CREATE POLICY "Users can delete their own comment likes" ON comment_likes
  FOR DELETE USING (auth.uid() = user_id);

-- 좋아요 수 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 좋아요 추가 시 카운트 증가
    UPDATE comments 
    SET like_count = like_count + 1 
    WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- 좋아요 삭제 시 카운트 감소
    UPDATE comments 
    SET like_count = GREATEST(like_count - 1, 0) 
    WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 좋아요 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_comment_like_count ON comment_likes;
CREATE TRIGGER trigger_update_comment_like_count
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION update_comment_like_count();

-- 좋아요 관련 저장 프로시저
-- 좋아요 토글 (좋아요 추가/제거)
CREATE OR REPLACE FUNCTION toggle_comment_like(
  p_comment_id UUID,
  p_user_id UUID
) 
RETURNS TABLE(
  liked BOOLEAN,
  like_count INTEGER
) AS $$
DECLARE
  existing_like_id UUID;
  current_like_count INTEGER;
BEGIN
  -- 기존 좋아요 확인
  SELECT id INTO existing_like_id
  FROM comment_likes
  WHERE comment_id = p_comment_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    -- 좋아요가 이미 있으면 삭제 (취소)
    DELETE FROM comment_likes WHERE id = existing_like_id;
    
    -- 현재 좋아요 수 조회
    SELECT comments.like_count INTO current_like_count
    FROM comments WHERE id = p_comment_id;
    
    RETURN QUERY SELECT false, current_like_count;
  ELSE
    -- 좋아요가 없으면 추가
    INSERT INTO comment_likes (comment_id, user_id)
    VALUES (p_comment_id, p_user_id);
    
    -- 현재 좋아요 수 조회
    SELECT comments.like_count INTO current_like_count
    FROM comments WHERE id = p_comment_id;
    
    RETURN QUERY SELECT true, current_like_count;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 사용자별 좋아요한 댓글 목록 조회 함수
CREATE OR REPLACE FUNCTION get_user_comment_likes(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  comment_id UUID,
  comment_content TEXT,
  post_id UUID,
  post_title TEXT,
  comment_author_name TEXT,
  liked_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.comment_id,
    c.content as comment_content,
    c.post_id,
    p.title as post_title,
    mp.display_name as comment_author_name,
    cl.created_at as liked_at
  FROM comment_likes cl
  JOIN comments c ON cl.comment_id = c.id
  JOIN posts p ON c.post_id = p.id
  JOIN member_profiles mp ON c.author_id = mp.id
  WHERE cl.user_id = p_user_id
    AND p.is_deleted = false
  ORDER BY cl.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 댓글별 좋아요한 사용자 목록 조회 함수 (관리자용)
CREATE OR REPLACE FUNCTION get_comment_likes(
  p_comment_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  user_id UUID,
  display_name TEXT,
  email TEXT,
  liked_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.user_id,
    mp.display_name,
    mp.email,
    cl.created_at as liked_at
  FROM comment_likes cl
  JOIN member_profiles mp ON cl.user_id = mp.id
  WHERE cl.comment_id = p_comment_id
  ORDER BY cl.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 댓글들의 좋아요 수 초기화 (0으로 설정)
UPDATE comments SET like_count = 0 WHERE like_count IS NULL;

-- 댓글
COMMENT ON TABLE comment_likes IS '댓글 좋아요 테이블';
COMMENT ON COLUMN comment_likes.comment_id IS '좋아요한 댓글 ID';
COMMENT ON COLUMN comment_likes.user_id IS '좋아요한 사용자 ID';
COMMENT ON COLUMN comments.like_count IS '댓글 좋아요 수';
COMMENT ON FUNCTION toggle_comment_like IS '댓글 좋아요 토글 (추가/제거)';
COMMENT ON FUNCTION get_user_comment_likes IS '사용자가 좋아요한 댓글 목록 조회';
COMMENT ON FUNCTION get_comment_likes IS '댓글을 좋아요한 사용자 목록 조회';