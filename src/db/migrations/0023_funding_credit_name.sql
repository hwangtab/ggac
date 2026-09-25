-- 리워드에 "이름 기재" 표시를, 후원에 기재할 이름을 더한다.
--
-- 부클릿·웹사이트 크레딧처럼 후원자 이름을 싣는 리워드는 결제자 이름과 다른
-- 이름(닉네임·팀명)을 받아야 한다. 기존 리워드는 전부 0(받지 않음)으로 떨어지고
-- 기존 후원의 credit_name은 NULL이다 — 이 마이그레이션만으로 바뀌는 화면은 없다.
BEGIN;
--> statement-breakpoint
ALTER TABLE `funding_rewards` ADD COLUMN `requires_credit_name` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `funding_pledges` ADD COLUMN `credit_name` text;
--> statement-breakpoint
COMMIT;
