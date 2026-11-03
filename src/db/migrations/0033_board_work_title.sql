-- 이사회 업무툴 직함 — 업무 화면에만 보이는 직함(`work_member_prefs.work_title`)을 더한다.
-- 설계: docs/board-work/03-통합-재설계.md §10(R4 메뉴·직함·서류함).
--
-- 업무 화면(사람 목록·멤버 고르기·프로필 카드·멘션·작성자 이름표)의 직함은 `work_title ?? member_profiles.director_title`
-- 이다. 비어 있으면(NULL) 지금처럼 이사회 직함이 보인다 — 이 마이그레이션만으로 바뀌는 화면은 없다.
-- 공식 직함(`member_profiles.director_title` — 출석·회의·관리자 회원 화면)은 건드리지 않고, 업무툴은 그 열을 쓰지 않는다.
-- 한도(0~50자, 앞뒤 공백 제거, 빈 값 → NULL)는 쓰기 경로(`updateStaffProfile`)가 판정한다 — 0027과 같은 규칙으로 CHECK 없음.
--
-- BEGIN/COMMIT은 0023과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `work_member_prefs` ADD COLUMN `work_title` text;
--> statement-breakpoint
COMMIT;
