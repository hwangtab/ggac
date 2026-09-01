-- 이벤트 신청 중복 방지: (event_slug, contact_phone) 유니크 인덱스.
--
-- 왜 필요한가: 같은 사람이 같은 행사에 두 번 들어온 행이 운영 DB에 실제로
-- 있었다(2026-06-02 승인 + 2026-06-26 대기, 동일 이름·이메일·연락처).
-- 앱 계층의 "이미 신청했는지" 검사만으로는 동시에 들어온 두 요청을 막지
-- 못한다 — 검사와 INSERT 사이가 벌어지기 때문이다. DB가 마지막으로 막는다.
--
-- NULL 취급: SQLite는 유니크 인덱스에서 NULL끼리를 서로 다른 값으로 본다.
-- `contact_phone`은 nullable이므로 연락처 없이 들어온 신청은 여러 건이어도
-- 이 제약에 걸리지 않는다. 연락처가 중복 판정의 유일한 기준이라 이 동작이
-- 의도한 것이다(연락처가 없으면 같은 사람인지 알 수 없다).
--
-- BEGIN/COMMIT: 이 저장소는 `drizzle-kit migrate`가 아니라 파일을 통째로
-- `executeMultiple()`로 적용하며 그 함수는 문마다 자동 커밋한다
-- (0013과 같은 이유 — scripts/testing/migrationAtomicity.test.mjs).
--
-- 적용 전 선행 조건: 기존 중복 행이 남아 있으면 이 인덱스 생성이 실패한다.
-- 운영 DB의 중복 1건은 2026-09-02에 정리했다(늦게 들어온 pending 행 삭제).
BEGIN;
CREATE UNIQUE INDEX `event_applications_slug_phone_idx` ON `event_applications` (`event_slug`,`contact_phone`);
COMMIT;
