-- `member_profiles.withdrawal_requested_at` — 탈퇴 "신청" 시각.
--
-- 왜 상태값이 아니라 타임스탬프인가: 처음 설계는 신청을
-- `registration_status = 'withdrawal_requested'`로 표현했다. 그런데
-- `src/lib/server/authz.ts`의 `isApprovedActive`(모든 접근 게이트의 뿌리)는
-- `registration_status === 'approved' && is_active === true`만 참으로 본다.
-- 그래서 신청하는 순간 본인이 승인·활성 조합원 판정에서 빠져
-- 취소 API(`requireActiveMember`)가 항상 403을 내고 `/mypage/settings`
-- 접근 자체가 튕겼다 — "신청 중에는 아무것도 바뀌지 않는다"는 설계 약속과
-- 정반대였다.
--
-- 저장소 안에 `registration_status === 'approved'` 직접 비교가 36곳 있어(실측,
-- 2026-09-01) `isApprovedActive` 하나만 넓히면 나머지 35곳이 여전히 신청자를
-- 배제한다 — 로그인은 되는데 글은 못 쓰고 알림 대상에서도 빠지는 반쪽 상태가
-- 된다. 신청을 상태가 아니라 타임스탬프로 표현하면 그 36곳을 하나도 손대지
-- 않고 그대로 옳게 동작한다: 신청 중에도 `registration_status`는 `'approved'`
-- 그대로다.
--
-- 표를 재작성하지 않는 `ALTER TABLE ADD COLUMN` 한 줄이다. `0007`·`0010`과
-- 같은 모양이며 `0002`가 가진 위험(재작성이 나중에 추가된 컬럼·인덱스를
-- 지우는 것)이 없다.
--
-- ⚠ 적용은 파일을 통째로 실행하는 경로로만 한다(`executeMultiple`).
-- `drizzle-kit migrate`는 쓰지 않는다 — 이 저장소의 규약이고, 마이그레이터가
-- 자체 트랜잭션으로 감싸면 아래 `BEGIN`이 즉시 실패한다.
BEGIN;
--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `withdrawal_requested_at` integer;
--> statement-breakpoint
COMMIT;
