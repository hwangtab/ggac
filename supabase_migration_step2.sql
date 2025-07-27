-- 2단계: 인덱스 생성 (별도 실행 필요)
-- CREATE INDEX CONCURRENTLY는 트랜잭션 블록 외부에서 실행해야 함

-- 성능 최적화를 위한 추가 인덱스 (동시성 개선)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_post_likes_user_post_unique 
ON post_likes (user_id, post_id);