-- 가짜 게시물 삭제 스크립트
-- 2025-09-10에 생성된 테스트 게시물들을 삭제

BEGIN;

-- 삭제할 가짜 게시물들의 ID 확인
SELECT 
  id, 
  title, 
  created_at,
  author_id,
  (SELECT display_name FROM member_profiles WHERE id = posts.author_id) as author_name
FROM posts 
WHERE id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',  -- 시스템 개선 건의
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',  -- 안녕하세요! 경기아트콜렉티브입니다
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',  -- 첫 번째 게시글입니다
  '262b02d7-0137-4538-9d7f-c937c050e8c9'   -- 작품 홍보 테스트
)
ORDER BY created_at;

-- 관련 데이터 삭제 (외래 키 제약 조건 고려)

-- 1. 댓글 좋아요 삭제 (만약 있다면)
DELETE FROM comment_likes 
WHERE comment_id IN (
  SELECT id FROM comments 
  WHERE post_id IN (
    '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
    '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
    '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
    '262b02d7-0137-4538-9d7f-c937c050e8c9'
  )
);

-- 2. 댓글 삭제
DELETE FROM comments 
WHERE post_id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
  '262b02d7-0137-4538-9d7f-c937c050e8c9'
);

-- 3. 게시물 좋아요 삭제
DELETE FROM post_likes 
WHERE post_id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
  '262b02d7-0137-4538-9d7f-c937c050e8c9'
);

-- 4. 첨부파일 삭제
DELETE FROM post_attachments 
WHERE post_id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
  '262b02d7-0137-4538-9d7f-c937c050e8c9'
);

-- 5. 알림 삭제 (관련된 것들)
DELETE FROM notifications 
WHERE related_post_id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
  '262b02d7-0137-4538-9d7f-c937c050e8c9'
);

-- 6. 마지막으로 게시물 삭제
DELETE FROM posts 
WHERE id IN (
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
  '262b02d7-0137-4538-9d7f-c937c050e8c9'
);

-- 삭제 후 확인
SELECT 'Posts after deletion:' as message;
SELECT COUNT(*) as remaining_posts FROM posts WHERE is_deleted = false;

COMMIT;

-- 삭제된 결과 확인
SELECT 'Verification - remaining posts:' as message;
SELECT id, title, created_at FROM posts ORDER BY created_at DESC;