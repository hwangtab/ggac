-- 메일함 답장의 받는 사람 기록 — 답장(`inbound_email_replies`)에 받는 사람·참조·수신자 수를 더한다.
--
-- ## 왜
--
-- 답장은 늘 원본 발신자 한 명에게 갔고, 그래서 기록할 칸도 없었다(보낸 편지함은 원본의 `from_address`를 받는
-- 사람으로 보여 줬다). 이제 `Reply-To`를 따르고 전체 답장(참조)이 생기므로 누구에게 갔는지를 행에 남긴다 —
-- 나간 메일은 영구 보관하는 감사 기록이다(2026-11-05 조직 결정). 일일 한도도 답장 한 통을 1명으로 세던 것을
-- `recipient_count` 합으로 센다(전체 답장 한 통이 여러 명에게 간다).
--
-- 기존 행: `to_address`·`cc_addresses`는 NULL로 둔다(읽는 쪽이 원본 `from_address`로 대신한다 — 그때는 실제로
-- 그 주소로 갔다). `recipient_count`는 기본값 1 — 예전 답장은 정확히 한 명에게 갔다.
--
-- 롤백: `ALTER TABLE inbound_email_replies DROP COLUMN recipient_count;` 등 세 칸을 지운다.
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `inbound_email_replies` ADD COLUMN `to_address` text;
--> statement-breakpoint
ALTER TABLE `inbound_email_replies` ADD COLUMN `cc_addresses` text;
--> statement-breakpoint
ALTER TABLE `inbound_email_replies` ADD COLUMN `recipient_count` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
COMMIT;
