-- 워크샵 등 비(非)마켓 행사 신청을 지원하기 위해, 사운드마켓 전용 컬럼의
-- NOT NULL 제약을 완화한다.
--   - items_to_sell : 워크샵에는 '판매할 물건'이 존재하지 않는다.
--   - contact_email : 신청 폼에서 이메일은 선택 항목이며, 신청 API가 이미
--                     빈 값일 때 NULL을 삽입하고 있어 스키마와 정합성을 맞춘다.
-- 이미 nullable이면 무해(no-op)하므로 재실행에 안전하다.

BEGIN;

ALTER TABLE public.event_applications
  ALTER COLUMN items_to_sell DROP NOT NULL,
  ALTER COLUMN contact_email DROP NOT NULL;

COMMIT;
