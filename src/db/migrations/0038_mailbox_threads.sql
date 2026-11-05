-- 메일함 대화 묶기 — 받은 메일에 대화 id(`thread_id`)를 더한다.
--
-- ## 왜
--
-- 상대가 우리 답장에 다시 답하면 무관한 새 메일로 쌓였다. `ingestInbound.ts`의 옛 주석이 남겨 둔 안
-- (`thread_root_id`)을 이름만 바꿔 따른다 — 값은 대화를 시작한 받은 메일의 id이고, 시작 메일은 자기 id를 갖는다.
--
-- ## 백필 규칙
--
-- 새 행은 `assignThread`(쿼리)와 `referencedMessageIds`(src/lib/mail/threading.ts)가 채운다. 아래 UPDATE는
-- 같은 규칙이다: 헤더의 `in-reply-to`·`references`가 `message_id`로 가리키는 **다른**, **이 메일보다 늦지 않게
-- 받은** 메일 중 가장 먼저 받은 것(같은 시각이면 id 순)의 **대화**. 없으면 자기 id. 앞 메일이어야 한다는 조건은
-- 서로를 가리키는 두 메일이 대화를 맞바꾸는 순환을 막는다. Message-ID는 `<...>`로 감싸여 있어(운영 실측 전부)
-- `instr`이 앞뒤가 붙은 다른 ID에 걸리지 않는다.
--
-- "그 메일의 대화"를 한 문장으로는 못 구한다 — 첫 UPDATE는 가리킨 메일의 id를 넣고, 뒤의 UPDATE 셋이 한 단계씩
-- 그 메일의 대화로 거슬러 오른다. `References`가 조상을 다 실으면 첫 단계에서 이미 시작 메일이고, `In-Reply-To`만
-- 있는 메일이 사슬로 이어질 때만 뒤 단계가 일한다. 네 단계 넘게 `In-Reply-To`만으로 이어진 사슬은 중간에서
-- 끊긴다(운영 데이터에는 없다 — References 없는 답장 0건).
--
-- 차이: JS는 헤더 키를 대소문자 없이 보고 ID를 50개까지만 따라간다. 운영 헤더 키는 전부 소문자였다.
-- 헤더가 깨진 JSON이면 `json_extract`가 실패하므로 `json_valid`로 거른다(그 행은 자기 대화가 된다).
-- 대조는 `scripts/testing/mailboxThreads.test.mjs`가 한다.
--
-- 롤백: `DROP INDEX inbound_emails_thread_idx; ALTER TABLE inbound_emails DROP COLUMN thread_id;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `thread_id` text;
--> statement-breakpoint
UPDATE `inbound_emails` SET `thread_id` = coalesce((
  SELECT p.`id` FROM `inbound_emails` p
  WHERE p.`id` <> `inbound_emails`.`id`
    AND p.`message_id` IS NOT NULL
    AND p.`received_at` <= `inbound_emails`.`received_at`
    AND json_valid(`inbound_emails`.`headers`)
    AND (instr(coalesce(json_extract(`inbound_emails`.`headers`, '$."in-reply-to"'), ''), p.`message_id`) > 0
      OR instr(coalesce(json_extract(`inbound_emails`.`headers`, '$."references"'), ''), p.`message_id`) > 0)
  ORDER BY p.`received_at` ASC, p.`id` ASC
  LIMIT 1
), `id`);
--> statement-breakpoint
UPDATE `inbound_emails` SET `thread_id` = (SELECT p.`thread_id` FROM `inbound_emails` p WHERE p.`id` = `inbound_emails`.`thread_id`) WHERE `thread_id` <> `id`;
--> statement-breakpoint
UPDATE `inbound_emails` SET `thread_id` = (SELECT p.`thread_id` FROM `inbound_emails` p WHERE p.`id` = `inbound_emails`.`thread_id`) WHERE `thread_id` <> `id`;
--> statement-breakpoint
UPDATE `inbound_emails` SET `thread_id` = (SELECT p.`thread_id` FROM `inbound_emails` p WHERE p.`id` = `inbound_emails`.`thread_id`) WHERE `thread_id` <> `id`;
--> statement-breakpoint
CREATE INDEX `inbound_emails_thread_idx` ON `inbound_emails` (`thread_id`,`received_at`);
--> statement-breakpoint
COMMIT;
