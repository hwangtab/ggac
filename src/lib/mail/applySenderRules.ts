/**
 * 받은 메일에 발신자 규칙을 적용한다 — 수신 웹훅이 메일을 저장한 뒤 응답 뒤에(`after`) 부른다.
 *
 * **절대 던지지 않는다.** 웹훅은 저장 뒤 예외가 나면 500을 줘 Resend가 다시 보내게 하는데, 그때 메일은 이미 저장돼
 * 재전송은 중복으로 걸러진다 — 규칙 실패로 500을 주면 규칙은 영영 다시 적용되지 않는다. 그래서 응답 뒤에 돌리고
 * 실패는 기록만 남긴다(메일은 안 읽음으로 남아 사람이 본다).
 *
 * 상태는 막 들어온 메일(`unread`)일 때만 옮긴다 — 그 사이 누가 이미 열어 바꿨으면 사람의 판단이 앞선다.
 */

import { rulesForSender } from '../../db/queries/mailboxRules.ts'
import { updateInboundStatus } from '../../db/queries/mailbox.ts'
import { setLabelOnEmails } from '../../db/queries/mailboxLabels.ts'
import { logSecurityEvent } from '../../utils/security.ts'

import { combineRules } from './senderRules.ts'

export async function applySenderRules(email: {
  id: string
  from_email: string | null
}): Promise<{ status: 'spam' | 'archived' | null; labelIds: string[] } | null> {
  try {
    const rules = await rulesForSender(email.from_email)
    if (rules.length === 0) return { status: null, labelIds: [] }
    const outcome = combineRules(rules)
    if (outcome.status) {
      await updateInboundStatus(email.id, 'unread', outcome.status)
    }
    for (const labelId of outcome.labelIds) {
      await setLabelOnEmails({ labelId, emailIds: [email.id], action: 'add', by: null })
    }
    return outcome
  } catch (error) {
    try {
      logSecurityEvent(
        'MAILBOX_SENDER_RULE_FAILED',
        { emailId: email.id, error: error instanceof Error ? error.message : 'unknown' },
        'medium'
      )
    } catch {
      // 기록 실패도 웹훅 흐름을 막지 않는다.
    }
    return null
  }
}
