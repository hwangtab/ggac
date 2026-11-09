import type { TransferRow } from '@/db/queries/timebankLedger'
import { getProfileEmail } from '@/db/queries/profiles'
import { isSendableEmail, renderNoticeEmail } from '@/lib/funding/notifyContent'
import { sendEmail } from '@/lib/mail/send'
import { pendingNoticeCopy } from '@/lib/server/timebankNotify'
import { createLogger } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'

const log = createLogger('timebankEmail')

/**
 * 확인 요청을 상대의 메일로도 보낸다. 사이트 알림은 들어와야 보이므로, 자주 오지 않는
 * 상대에게 기록이 대기로만 남아 잔액에 영영 들어가지 않는 일을 막는다.
 *
 * `notifyTransferPending`과 같은 계약이다: **던지지 않는다.** 원장은 이미 커밋됐고,
 * 메일이 실패해도 사이트 알림은 남는다. 키가 없으면 조용히 건너뛴다.
 */
export async function emailTransferPending(row: TransferRow): Promise<void> {
  try {
    if (!row?.counterparty_id) return
    if (!process.env.RESEND_API_KEY) return
    const to = await getProfileEmail(row.counterparty_id)
    if (!isSendableEmail(to)) return
    const copy = pendingNoticeCopy(row)
    const { subject, html } = renderNoticeEmail(
      {
        title: copy.title,
        message: copy.message,
        url: `${getSiteUrl()}/mypage/timebank#pending`,
        cta: '확인하러 가기',
        data: {},
      },
      row.memo ? [`메모: ${row.memo}`] : []
    )
    await sendEmail({ to, subject, html, idempotencyKey: `timebank-pending-${row.id}` })
  } catch (e) {
    log.error('타임뱅크 확인 요청 메일 실패', {
      transferId: row?.id,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
