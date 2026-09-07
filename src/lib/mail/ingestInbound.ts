/**
 * 받은 메일의 본문과 첨부를 Resend에서 당겨 우리 저장소로 옮긴다.
 *
 * Resend는 30일만 보관하고 첨부 URL은 한 시간이면 만료된다. 그래서 웹훅을
 * 받자마자 여기를 부른다.
 *
 * **던지지 않는다.** 실패는 `body_fetch_status`에 남기고 조용히 끝낸다 —
 * 호출부(웹훅)가 500을 내면 Resend가 재시도하고 그 재시도가 다시 쿼터를 먹는다.
 * 못 채운 행은 백필 크론이 나중에 가져간다.
 */
import { randomUUID } from 'node:crypto'

// `@/` 별칭은 node 테스트 러너가 해석하지 못한다(`queriesMisc.test.mjs`의 같은
// 제약 참고). 이 모듈은 브리프의 테스트가 직접 import하므로 상대 경로를 쓴다.
import { putObject } from '../storage/blob.ts'
import { logSecurityEvent } from '../../utils/security.ts'

import { fetchReceivedEmail, listReceivedAttachments, downloadAttachment } from './inboundClient.ts'
import { blobPathForAttachment } from '../storage/mailboxAttachments.ts'
import { markBodyFetched, insertAttachment } from '../../db/queries/mailbox.ts'

/**
 * 세 번째 인자는 테스트 전용 주입 자리다 — 기본값은 실제 `putObject`(운영
 * Blob에 쓴다). 첨부 테스트가 조합의 비공개 저장소에 실제로 쓰는 사고를
 * 막기 위해 `putObject`를 스텁으로 바꿔 넣을 수 있게 열어 둔다. 호출부
 * (웹훅 라우트)는 이 인자를 넘기지 않는다 — 항상 실제 구현을 쓴다.
 */
export async function ingestInboundEmail(
  resendEmailId: string,
  rowId: string,
  deps: { putObject: typeof putObject } = { putObject }
): Promise<void> {
  const put = deps.putObject
  try {
    const email = await fetchReceivedEmail(resendEmailId)
    await markBodyFetched(rowId, {
      body_html: email.html,
      body_text: email.text,
      headers: JSON.stringify(email.headers ?? {}),
      subject: email.subject,
    })
  } catch (error) {
    // 상태를 'pending'으로 그대로 둔다 — 여기서 markBodyFetchFailed를 부르면
    // Task 7의 유일한 복구 쿼리(listPendingInboundEmails)가 'pending'만 읽어
    // 이 행이 백필의 눈에 영영 안 보이게 된다. 삽입 시 기본값이 이미
    // 'pending'이므로 아무것도 쓰지 않으면 다음 백필 실행이 이 행을 다시
    // 집어 재시도한다.
    logSecurityEvent(
      'MAILBOX_BODY_FETCH_FAILED',
      { rowId, error: error instanceof Error ? error.message : 'unknown' },
      'medium'
    )
    return
  }

  // 첨부는 개별 실패를 허용한다 — 하나가 막혀도 나머지와 본문은 살린다.
  try {
    const attachments = await listReceivedAttachments(resendEmailId)
    for (const attachment of attachments) {
      try {
        const bytes = await downloadAttachment(attachment.download_url)
        const attachmentId = randomUUID()
        const path = blobPathForAttachment(rowId, attachmentId, attachment.filename)
        await put(
          'private',
          path,
          bytes,
          attachment.content_type ?? 'application/octet-stream',
          false
        )
        await insertAttachment({
          id: attachmentId,
          email_id: rowId,
          filename: attachment.filename,
          content_type: attachment.content_type,
          content_id: attachment.content_id,
          size_bytes: attachment.size,
          blob_path: path,
        })
      } catch (error) {
        // 본문은 이미 'done'으로 표시돼 백필이 이 행을 다시 안 본다 — 이
        // 첨부는 조용히 영영 빠진다. 잡음이 아니라 데이터 손실이라 severity를
        // 'medium'으로 둔다.
        logSecurityEvent(
          'MAILBOX_ATTACHMENT_COPY_FAILED',
          {
            rowId,
            filename: attachment.filename,
            error: error instanceof Error ? error.message : 'unknown',
          },
          'medium'
        )
      }
    }
  } catch (error) {
    // 목록 조회 자체가 실패하면 첨부 전체가 빠진다 — 위와 같은 이유로 'medium'.
    logSecurityEvent(
      'MAILBOX_ATTACHMENT_LIST_FAILED',
      { rowId, error: error instanceof Error ? error.message : 'unknown' },
      'medium'
    )
  }
}
