-- `member_profiles.withdrawn_at` — 탈퇴가 확정된 시각.
--
-- 표를 재작성하지 않는 `ALTER TABLE ADD COLUMN` 한 줄이다. `0007`과 같은 모양이며
-- `0002`가 가진 위험(재작성이 나중에 추가된 컬럼·인덱스를 지우는 것)이 없다.
--
-- ⚠ 적용은 파일을 통째로 실행하는 경로로만 한다(`executeMultiple`).
-- `drizzle-kit migrate`는 쓰지 않는다 — 이 저장소의 규약이고, 마이그레이터가
-- 자체 트랜잭션으로 감싸면 아래 `BEGIN`이 즉시 실패한다.
BEGIN;
--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `withdrawn_at` integer;
--> statement-breakpoint
COMMIT;
