-- 조합원 관심 장르·지역 컬럼(member_profiles.interest_genres/interest_regions).
--
-- BEGIN/COMMIT으로 감싸는 이유: 이 저장소는 `drizzle-kit migrate`를 쓰지 않고 파일을
-- 통째로 `executeMultiple()`로 적용하는데, 그 함수는 **문마다 자동 커밋**한다. 감싸지
-- 않으면 두 번째 ALTER가 실패했을 때 첫 번째 컬럼만 추가된 반쪽 상태가 남고,
-- 재실행해도 그 컬럼 때문에 또 실패해 손으로 DROP COLUMN하기 전까지 교착된다
-- (scripts/testing/migrationAtomicity.test.mjs).
--
-- `drizzle-kit generate`가 처음 낸 산출물에는 이 두 ALTER 외에 기존
-- 성능 인덱스(0004/0005가 손으로 만든 것) 23개의 CREATE INDEX가 함께 딸려
-- 나왔다 — `meta/0010_snapshot.json`이 그 인덱스들을 추적하지 않고 있었던
-- 사전 드리프트 때문이다(0004/0005는 `drizzle-kit generate`를 거치지 않고
-- 손으로 작성·적용됐다). 그 인덱스들은 이미 운영·로컬 DB에 존재하므로
-- 여기서 다시 만들면 "already exists"로 실패한다. 이 파일에서는 그 20+3개
-- CREATE INDEX 문을 걷어내고 이번 태스크가 실제로 필요로 하는 ALTER 2개만
-- 남겼다 — `meta/0011_snapshot.json`은 손대지 않았으므로(전체 상태 스냅샷이라
-- 인덱스가 실제로 존재한다는 사실 자체는 정확하다) 다음 `db:generate`부터는
-- 이 드리프트가 재발하지 않는다.
BEGIN;
ALTER TABLE `member_profiles` ADD `interest_genres` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `interest_regions` text DEFAULT '[]' NOT NULL;
COMMIT;
