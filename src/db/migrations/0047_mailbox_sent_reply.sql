-- 보낸 메일에 온 답장을 잇는다 — `outbound_emails.message_id`(0047)와 `inbound_emails.reply_to_outbound_id`.
--
-- ## 왜
--
-- 새로 작성해 보낸 메일에 상대가 답장하면, 그 답장의 `In-Reply-To`/`References`에는 **우리가 보낸 메일의
-- `Message-ID`**가 들어 있다. 그런데 우리 답장(받은 메일에 대한 답장)과 달리 이 값은 우리가 만든 적이 없어서,
-- 지금까지는 그 답장이 목록에 홀로 떴다("무엇에 대한 답장인지" 화면이 몰랐다).
--
-- `Message-ID`는 SES가 정하고 우리가 지정할 수 없다(커스텀 `Message-ID` 헤더는 덮어써진다). Resend
-- `GET /emails/:id`가 실제 값을 알려 주므로(2026-07 추가) 발송 뒤에 받아 `outbound_emails.message_id`에 둔다.
-- 그러면 수신 웹훅이 본문을 당길 때 헤더의 id와 **정확히** 대조해 답장을 잇는다 — 제목·수신자 추측이 아니다.
--
-- 두 칸 다 비어 있을 수 있다(백필 전·조회 실패·기존 행). 롤백: 인덱스 둘을 지우고 두 칸을 `DROP COLUMN`.
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `outbound_emails` ADD COLUMN `message_id` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `reply_to_outbound_id` text REFERENCES `outbound_emails`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `outbound_emails_message_id_idx` ON `outbound_emails` (`message_id`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_sent_reply_idx` ON `inbound_emails` (`reply_to_outbound_id`);
--> statement-breakpoint
COMMIT;
