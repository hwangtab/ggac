-- 예매–결제 결합 고리와 누락된 성능 인덱스.
--
-- ## 1. reservations.order_id — 왜 컬럼을 더하는가
--
-- 승인 라우트(`/api/tickets/confirm`)는 `orderId`로 결제를, `reservationId`로
-- 예매를 각각 찾아 놓고 **둘이 같은 건인지 대조하지 않았다.** 대조할 방법이
-- 없었다 — `reservations.payment_id`는 승인이 끝난 뒤에야 채워지므로 승인을
-- 판단하는 시점에는 비어 있다.
--
-- 그 틈으로 두 가지가 통과했다. 싼 주문을 실제로 결제한 뒤 비싼 예매의 id를
-- 실어 보내면 금액 검사(결제 원장 기준)를 통과하고 비싼 좌석이 확정됐다. 또
-- 금액이 어긋났을 때 라우트가 요청이 지목한 예매를 취소해 줬으므로, 결제를 한
-- 푼도 하지 않고 남의 대기 예매를 없앨 수 있었다.
--
-- 주문번호를 **선점과 같은 INSERT에** 새기면 그 틈이 없어진다. 이제 확정과
-- 취소가 모두 `order_id`를 WHERE에 넣고 돌므로, 짝이 맞지 않으면 0행이 바뀐다.
--
-- NULL을 허용하는 이유: 이 컬럼이 생기기 전의 예매가 이미 있다. 그런 예매는
-- 이 경로로 확정되지 않고 사무국 문의로 간다(라우트가 명시적으로 거부한다).
-- SQLite는 NULL을 서로 다른 값으로 보므로 옛 행들이 유니크 제약에 걸리지 않는다.
--
-- ## 2. reservations_code_idx 삭제
--
-- 0016이 같은 유니크 인덱스를 두 벌 만들었다 — 컬럼 선언의 `.unique()`가 만든
-- 자동 인덱스와, 인덱스 배열에 손으로 적은 `reservations_code_idx`다. 예매를
-- 넣을 때마다 같은 것을 두 번 갱신한다. 남는 쪽(`.unique()`)이 제약을 그대로
-- 지키므로 유일성은 변하지 않는다.
--
-- ## 3. 인덱스 넷
--
-- 넷 다 "이 조회를 덮는 인덱스가 없다"는 같은 이유다:
--   - payments(user_id, created_at)      마이페이지 영수증 목록
--   - membership_dues(billing_month, ..) 매월 청구 크론. 기존 유니크는 선두가 user_id
--   - reservations(status, hold_..)      만료 선점 정리. 기존 인덱스는 선두가 show_id
--   - board_meetings(created_at)         회의 목록. 이 표엔 인덱스가 하나도 없었다
--   - user_sessions(login_at)            관리자 세션 목록. 기존 셋은 last_activity 기준
--
-- BEGIN/COMMIT: 0013~0016과 같은 이유 — 이 저장소는 파일을 통째로
-- executeMultiple()로 적용하며 그 함수는 문마다 자동 커밋한다.
BEGIN;

ALTER TABLE `reservations` ADD COLUMN `order_id` text;
CREATE UNIQUE INDEX `reservations_order_id_idx` ON `reservations` (`order_id`);

DROP INDEX IF EXISTS `reservations_code_idx`;

CREATE INDEX IF NOT EXISTS `reservations_status_hold_idx` ON `reservations` (`status`, `hold_expires_at`);
CREATE INDEX IF NOT EXISTS `idx_payments_user_created` ON `payments` (`user_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `idx_membership_dues_month_status` ON `membership_dues` (`billing_month`, `status`);
CREATE INDEX IF NOT EXISTS `idx_board_meetings_created_at` ON `board_meetings` (`created_at`);
CREATE INDEX IF NOT EXISTS `idx_user_sessions_login_at` ON `user_sessions` (`login_at`);

COMMIT;
