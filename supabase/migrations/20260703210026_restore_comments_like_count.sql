-- comments.like_count 컬럼·트리거·인덱스 복원 (마이그레이션 드리프트 교정)
--
-- 배경: 20250724090050_create_comment_likes_table.sql 이 applied 로 마킹됐으나
-- 운영 DB 에 comments.like_count 컬럼과 idx_comments_like_count 인덱스가 실제로는
-- 미생성 상태로 드리프트됨. 그 결과 댓글 목록 API 가 42703(undefined_column)으로
-- 실패하고 toggle_comment_like RPC 도 깨짐. 원본 마이그레이션은 이미 applied 마킹돼
-- 재푸시가 불가하므로, 아래 idempotent 교정 마이그레이션으로 컬럼·트리거·인덱스를
-- 복원하고 기존 comment_likes 데이터를 like_count 로 백필한다.
-- (함수·트리거는 운영에 이미 존재하나 OR REPLACE / DROP IF EXISTS 로 재실행 안전.)

-- comments.like_count 컬럼 복원 (드리프트 교정)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;

-- 좋아요 수 자동 갱신 함수·트리거 재부착 (OR REPLACE / DROP IF EXISTS 로 idempotent)
CREATE OR REPLACE FUNCTION update_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_comment_like_count ON comment_likes;
CREATE TRIGGER trigger_update_comment_like_count
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION update_comment_like_count();

CREATE INDEX IF NOT EXISTS idx_comments_like_count ON comments(like_count);

-- 기존 comment_likes 데이터로 like_count 백필 (드리프트 기간 동안 쌓인 좋아요 반영)
UPDATE comments c
SET like_count = COALESCE(sub.cnt, 0)
FROM (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) sub
WHERE c.id = sub.comment_id;
