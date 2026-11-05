-- 메일함 발신자 필터 — 받은 메일에 정규화한 발신 주소(`from_email`)와 표시 이름(`from_name`)을 더한다.
--
-- ## 왜
--
-- `from_address`는 Resend 웹훅의 `from`을 그대로 담아 `홍길동 <hong@a.org>` 꼴일 수 있다. 그 칸에 `LIKE`로
-- "이 사람이 보낸 메일"을 찾으면 `kim@a.org`가 `akim@a.org`까지 잡는다. 정규화한 주소를 따로 두고 완전
-- 일치(`from_email = ?`)로 거른다. 원문 `from_address`는 감사 기록으로 그대로 둔다.
--
-- ## 백필 규칙
--
-- 새 행은 `src/lib/mail/senderAddress.ts`의 `parseMailbox`가 채운다. 아래 UPDATE는 **같은 규칙**이다:
-- 첫 `<` 뒤에 첫 `>`가 있으면 그 사이가 주소, `<` 앞이 이름(공백·큰따옴표를 털고 비면 NULL), 아니면 통째로
-- 주소(비면 NULL). 공백은 JS `trim()`에 맞춰 스페이스·탭·CR·LF를 턴다. 차이 하나: SQLite `lower()`는 ASCII만 내린다
-- (JS `toLowerCase()`는 유니코드 전체) — 주소에 ASCII 밖 대문자가 있는 드문 행만 갈린다.
-- 두 규칙의 대조는 `scripts/testing/mailboxSender.test.mjs`가 한다.
--
-- 칸은 NULL 허용이다 — SQLite `ADD COLUMN`은 기본값 없이 NOT NULL을 붙일 수 없다. 쓰기 경로가 항상 채운다.
-- 롤백: `DROP INDEX inbound_emails_from_email_idx; ALTER TABLE inbound_emails DROP COLUMN from_name;
-- ALTER TABLE inbound_emails DROP COLUMN from_email;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `from_email` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `from_name` text;
--> statement-breakpoint
UPDATE `inbound_emails` SET
  `from_email` = nullif(lower(trim(
    CASE WHEN instr(`from_address`, '<') > 0 AND instr(`from_address`, '>') > instr(`from_address`, '<')
      THEN substr(`from_address`, instr(`from_address`, '<') + 1,
                  instr(`from_address`, '>') - instr(`from_address`, '<') - 1)
      ELSE `from_address`
    END, ' ' || char(9) || char(10) || char(13))), ''),
  `from_name` = CASE WHEN instr(`from_address`, '<') > 0 AND instr(`from_address`, '>') > instr(`from_address`, '<')
    THEN nullif(trim(trim(trim(substr(`from_address`, 1, instr(`from_address`, '<') - 1),
                               ' ' || char(9) || char(10) || char(13)), '"'),
                     ' ' || char(9) || char(10) || char(13)), '')
    ELSE NULL
  END;
--> statement-breakpoint
CREATE INDEX `inbound_emails_from_email_idx` ON `inbound_emails` (`from_email`,`received_at`);
--> statement-breakpoint
COMMIT;
