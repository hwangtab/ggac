/**
 * 받은 메일의 본문과 첨부를 Resend에서 당겨 우리 저장소로 옮긴다.
 *
 * Resend는 30일만 보관하고 첨부 URL은 한 시간이면 만료된다. 그래서 웹훅을
 * 받자마자 여기를 부른다.
 *
 * **던지지 않는다.** 실패는 `body_fetch_status`에 남기고 조용히 끝낸다 —
 * 호출부(웹훅)가 500을 내면 Resend가 재시도하고 그 재시도가 다시 쿼터를 먹는다.
 * 못 채운 행은 백필 크론이 나중에 가져간다. 본문은 됐는데 첨부만 빠지면
 * `'attachments_failed'`로 남아 같은 백필이 다시 집는다 — 재호출은 이미
 * 복사된 첨부를 (파일명, content_id)로 걸러 건너뛰고 빠진 것만 다시 받는다.
 */
import { randomUUID } from 'node:crypto'

// `@/` 별칭은 node 테스트 러너가 해석하지 못한다(`queriesMisc.test.mjs`의 같은
// 제약 참고). 이 모듈은 브리프의 테스트가 직접 import하므로 상대 경로를 쓴다.
import { putObject } from '../storage/blob.ts'
import { logSecurityEvent } from '../../utils/security.ts'

import { fetchReceivedEmail, listReceivedAttachments, downloadAttachment } from './inboundClient.ts'
import { blobPathForAttachment } from '../storage/mailboxAttachments.ts'
import { referencedMessageIds } from './threading.ts'
import {
  markBodyFetched,
  assignThread,
  linkSentReply,
  insertAttachment,
  listAttachmentsForEmail,
  markAttachmentsIncomplete,
} from '../../db/queries/mailbox.ts'

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
    // 헤더는 통째로 JSON 문자열로 저장하고, 그 안의 In-Reply-To/References로 앞 메일의 대화에 붙인다
    // (`assignThread`, 규칙은 lib/mail/threading.ts). `thread_references`는 방향이 반대다 — 관리자가 답장할 때
    // 원본의 message-id를 그 행에 쌓아 두는 칸이다(reply 라우트 → appendThreadReference).
    await markBodyFetched(rowId, {
      body_html: email.html,
      body_text: email.text,
      headers: JSON.stringify(email.headers ?? {}),
      subject: email.subject,
    })
    // 대화 묶기는 부가 기능이다 — 실패해도 본문 저장과 첨부 복사는 계속한다. 본문이 이미 done이라 백필이 다시
    // 집지 않으므로, 실패한 메일은 자기 대화로 남는다(기록만 남긴다).
    //
    // 받은 메일끼리의 대화(`assignThread`)가 먼저다. 앞 메일이 없으면 **우리가 새로 작성해 보낸 메일**에 온
    // 답장인지 본다(`linkSentReply`) — 보낸 메일의 `Message-ID`는 SES가 정해 우리가 만든 적이 없으므로, 발송
    // 뒤에 Resend에 물어 저장해 둔 값과 대조한다. 둘 다 부가 기능이라 실패해도 본문은 남긴다.
    try {
      const referenced = referencedMessageIds(email.headers)
      const threadId = await assignThread(rowId, referenced)
      if (!threadId) await linkSentReply(rowId, referenced)
    } catch (error) {
      logSecurityEvent(
        'MAILBOX_THREAD_ASSIGN_FAILED',
        { rowId, error: error instanceof Error ? error.message : 'unknown' },
        'low'
      )
    }
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
  // 실패가 하나라도 있으면 끝에서 상태를 'attachments_failed'로 내려
  // 백필 크론(listPendingInboundEmails)이 다시 이 행을 집게 한다.
  let hadAttachmentFailure = false
  try {
    // 재시도 호출일 수 있다 — 이미 복사해 둔 첨부를 또 받아 중복 행을
    // 만들지 않도록, Resend 쪽 목록을 (파일명, content_id) 조합으로
    // 우리 쪽에 이미 있는지 먼저 대조한다. Resend가 첨부마다 매기는 `id`는
    // 우리 표에 저장하지 않으므로(별도 컬럼이 필요해 이번 손질 범위 밖) 이
    // 조합을 대신 쓴다 — 같은 메일 안에서 파일명+content_id가 겹치는 첨부는
    // 사실상 없다고 본다.
    const existing = await listAttachmentsForEmail(rowId)
    const alreadyCopied = new Set(
      existing.map(a => `${String(a.filename ?? '')}::${String(a.content_id ?? '')}`)
    )

    const attachments = await listReceivedAttachments(resendEmailId)
    for (const attachment of attachments) {
      const key = `${attachment.filename}::${attachment.content_id ?? ''}`
      if (alreadyCopied.has(key)) continue
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
        // 이 첨부만 건너뛴다 — 아래에서 상태를 내려 다음 백필이 다시 본다.
        hadAttachmentFailure = true
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
    hadAttachmentFailure = true
    logSecurityEvent(
      'MAILBOX_ATTACHMENT_LIST_FAILED',
      { rowId, error: error instanceof Error ? error.message : 'unknown' },
      'medium'
    )
  }

  if (hadAttachmentFailure) {
    // markBodyFetched가 이미 'done'으로 올려놨다 — 이대로 두면 첨부가
    // 조용히 영영 빠진 채 아무도 다시 안 본다. 이 함수는 "던지지 않는다"는
    // 계약이 있어(파일 docstring, 백필 크론이 for 루프에서 그대로 믿는다)
    // 이 업데이트 자체가 실패해도 여기서 삼킨다 — 다만 그러면 상태가
    // 'done'에 그대로 머물러 다음 백필도 이 행을 못 본다. 드문 경우라
    // 로그로만 남기고, 이 실패가 반복되면 그 로그가 신호가 된다.
    try {
      await markAttachmentsIncomplete(rowId)
    } catch (error) {
      logSecurityEvent(
        'MAILBOX_ATTACHMENT_STATUS_UPDATE_FAILED',
        { rowId, error: error instanceof Error ? error.message : 'unknown' },
        'medium'
      )
    }
  }
}
