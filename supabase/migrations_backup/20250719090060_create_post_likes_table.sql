-- 게시글 좋아요/추천 시스템 테이블 생성
-- 사용자가 게시글에 좋아요를 누를 수 있는 시스템

-- 게시글 좋아요 테이블
CREATE TABLE IF NOT EXISTS post_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 한 사용자가 하나의 게시글에 중복 좋아요 방지
  UNIQUE(post_id, user_id)
);

-- 게시글 좋아요 통계 컬럼 추가 (posts 테이블에)
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_like_count ON posts(like_count);

-- RLS 정책 설정
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자는 좋아요 목록을 조회할 수 있음
CREATE POLICY "Anyone can view likes" ON post_likes
  FOR SELECT USING (true);

-- 인증된 사용자는 자신의 좋아요를 생성할 수 있음
CREATE POLICY "Users can create their own likes" ON post_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 인증된 사용자는 자신의 좋아요를 삭제할 수 있음 (취소)
CREATE POLICY "Users can delete their own likes" ON post_likes
  FOR DELETE USING (auth.uid() = user_id);

-- 좋아요 수 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 좋아요 추가 시 카운트 증가
    UPDATE posts 
    SET like_count = like_count + 1 
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- 좋아요 삭제 시 카운트 감소
    UPDATE posts 
    SET like_count = GREATEST(like_count - 1, 0) 
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 좋아요 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_post_like_count ON post_likes;
CREATE TRIGGER trigger_update_post_like_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

-- 좋아요 관련 저장 프로시저
-- 좋아요 토글 (좋아요 추가/제거)
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
BEGIN
  -- 기존 좋아요 확인
  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    -- 좋아요가 이미 있으면 삭제 (취소)
    DELETE FROM post_likes WHERE id = existing_like_id;
    
    -- 현재 좋아요 수 조회
    SELECT posts.like_count INTO current_like_count
    FROM posts WHERE id = p_post_id;
    
    RETURN QUERY SELECT false, current_like_count;
  ELSE
    -- 좋아요가 없으면 추가
    INSERT INTO post_likes (post_id, user_id)
    VALUES (p_post_id, p_user_id);
    
    -- 현재 좋아요 수 조회
    SELECT posts.like_count INTO current_like_count
    FROM posts WHERE id = p_post_id;
    
    RETURN QUERY SELECT true, current_like_count;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 사용자별 좋아요 목록 조회 함수
CREATE OR REPLACE FUNCTION get_user_likes(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  post_id UUID,
  post_title TEXT,
  post_category TEXT,
  post_author_name TEXT,
  liked_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pl.post_id,
    p.title as post_title,
    p.category as post_category,
    mp.display_name as post_author_name,
    pl.created_at as liked_at
  FROM post_likes pl
  JOIN posts p ON pl.post_id = p.id
  JOIN member_profiles mp ON p.author_id = mp.id
  WHERE pl.user_id = p_user_id
    AND p.is_deleted = false
  ORDER BY pl.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게시글별 좋아요한 사용자 목록 조회 함수 (관리자용)
CREATE OR REPLACE FUNCTION get_post_likes(
  p_post_id UUID,
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
    pl.user_id,
    mp.display_name,
    mp.email,
    pl.created_at as liked_at
  FROM post_likes pl
  JOIN member_profiles mp ON pl.user_id = mp.id
  WHERE pl.post_id = p_post_id
  ORDER BY pl.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 게시글들의 좋아요 수 초기화 (0으로 설정)
UPDATE posts SET like_count = 0 WHERE like_count IS NULL;

-- 댓글
COMMENT ON TABLE post_likes IS '게시글 좋아요 테이블';
COMMENT ON COLUMN post_likes.post_id IS '좋아요한 게시글 ID';
COMMENT ON COLUMN post_likes.user_id IS '좋아요한 사용자 ID';
COMMENT ON COLUMN posts.like_count IS '게시글 좋아요 수';
COMMENT ON FUNCTION toggle_post_like IS '게시글 좋아요 토글 (추가/제거)';
COMMENT ON FUNCTION get_user_likes IS '사용자가 좋아요한 게시글 목록 조회';
COMMENT ON FUNCTION get_post_likes IS '게시글을 좋아요한 사용자 목록 조회';