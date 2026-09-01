-- 게시글당 대표 이미지는 하나뿐: post_attachments(post_id) WHERE is_primary = 1.
--
-- 왜 필요한가: "남의 대표 해제"와 "내 대표 지정"이 라우트에서 두 번의 별개
-- 호출로 나뉘어 있었다. 서로 다른 첨부를 대표로 지정하는 두 요청이 겹치면
-- 둘 다 is_primary = 1로 남을 수 있다(업로드 경로는 해제 실패를 console.warn만
-- 하고 계속 진행하기까지 했다). 두 호출을 쿼리 계층의 한 트랜잭션으로 묶었고,
-- 이 인덱스가 그것이 풀렸을 때 깨지도록 하는 마지막 방어선이다.
--
-- 부분 인덱스인 이유: is_primary = 0인 첨부는 게시글당 여러 건이 정상이다.
-- WHERE 절 없이 (post_id, is_primary)에 걸면 그것까지 막아 버린다.
--
-- 임시 첨부(post_id = 'temp-{UUID}')는 게시글마다 id가 달라 이 제약과
-- 충돌하지 않는다.
--
-- BEGIN/COMMIT: 0013·0014와 같은 이유 — 이 저장소는 파일을 통째로
-- executeMultiple()로 적용하며 그 함수는 문마다 자동 커밋한다.
--
-- 적용 전 확인(2026-09-02 운영 실측): 다중 primary 게시글 0건, 첨부 2행 중
-- is_primary = 1이 0행. 기존 데이터가 이 제약을 위반하지 않는다.
BEGIN;
CREATE UNIQUE INDEX `post_attachments_primary_idx` ON `post_attachments` (`post_id`) WHERE `is_primary` = 1;
COMMIT;
