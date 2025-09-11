-- post_likes 테이블에서 실제 게시물 ID 추출
-- 현재 가짜 게시물 4개를 제외한 진짜 게시물 ID들을 찾기

-- 현재 가짜 게시물 ID들 (2025-09-10 생성)
-- 9a04f79d-f06d-47f8-97f6-7b8ff9773068
-- 7b4281b3-c731-4a9a-972e-c6b1b188bb2a  
-- 4ff201b2-9b8a-47ba-8fa9-740852eb4598
-- 262b02d7-0137-4538-9d7f-c937c050e8c9

-- post_likes에서 위 가짜 ID들을 제외한 실제 게시물 ID들 추출
SELECT DISTINCT post_id, COUNT(*) as like_count
FROM post_likes 
WHERE post_id NOT IN (
    '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
    '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
    '4ff201b2-9b8a-47ba-8fa9-740852eb4598', 
    '262b02d7-0137-4538-9d7f-c937c050e8c9'
)
GROUP BY post_id
ORDER BY like_count DESC;

-- 실제 게시물 ID들의 생성일 정보 (만약 posts 테이블에 남아있다면)
SELECT post_id, user_id, created_at 
FROM post_likes 
WHERE post_id NOT IN (
    '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
    '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
    '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
    '262b02d7-0137-4538-9d7f-c937c050e8c9'
)
ORDER BY created_at ASC;

-- 전체 post_likes 개수 확인
SELECT COUNT(*) as total_likes FROM post_likes;

-- 가짜 게시물에 대한 좋아요 개수
SELECT COUNT(*) as fake_post_likes 
FROM post_likes 
WHERE post_id IN (
    '9a04f79d-f06d-47f8-97f6-7b8ff9773068',
    '7b4281b3-c731-4a9a-972e-c6b1b188bb2a',
    '4ff201b2-9b8a-47ba-8fa9-740852eb4598',
    '262b02d7-0137-4538-9d7f-c937c050e8c9'
);