/**
 * "결제 확인 필요" 사무국 공지.
 *
 * 대사가 스스로 풀지 못한 결제는 로그에만 남으면 아무도 보지 않는다. 그중에는
 * **승인된 돈이 붙어 있는데 표도 납부도 없는** 건이 섞일 수 있어서, 사람이
 * 토스 거래 내역을 열어 봐야 결말이 난다. 후원 쪽 `notifyStuckHolds`가 하던
 * 일을 예매·조합비까지 쓰도록 종류만 바꿔 끼우게 만든 것이다.
 *
 * 지키는 성질은 후원 공지와 같다.
 *
 * - **0건이면 아무것도 하지 않는다.**
 * - **하루 한 번만.** 크론은 10분마다 같은 것을 다시 발견한다.
 * - **절대 던지지 않는다.** 크론이 알림 때문에 죽으면 정리 자체가 멈춘다.
 * - 선택 알림이다(수신거부 존중) — 사무국 업무 통지이지 누군가의 영수증이 아니다.
 *
 * 메일 렌더링과 일괄 발송은 후원 쪽 도구를 그대로 쓴다. 두 함수 모두 펀딩을
 * 모르는 범용 도구이고, 같은 것을 한 벌 더 만들면 문안만 어긋난다.
 */

import { createBulkNotifications, hasRecentSystemNotice } from '../../db/queries/notifications.ts'
import { listAdminRecipients } from '../../db/queries/profiles.ts'
import { getUserSettingsByUserIds } from '../../db/queries/settings.ts'
import { renderNoticeEmail, sendManyEmails } from '../funding/notifyContent.ts'
import { sendEmail } from '../mail/send.ts'
import { isEmailOptedOut, type SettingLike } from '../server/grantPublish.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('payments/notifyStuck')

const DAY_MS = 86_400_000

/** 같은 종류의 공지를 이 시간 안에 이미 냈으면 다시 내지 않는다. */
export const STUCK_NOTICE_WINDOW_MS = DAY_MS

export interface StuckPaymentsInput {
  /** 공지 종류. 하루 한 번 억제의 열쇠이자 인앱 알림 `data.kind`. */
  kind: string
  /** 문장에 넣을 이름 — '예매', '조합비'. */
  label: string
  /** 무엇을 해 달라는 부탁인지 한 문장. */
  action: string
  count: number
  orderIds: string[]
}

export interface NotifyStuckDeps {
  listAdminRecipients: () => Promise<{ id: string; email: string | null }[]>
  getUserSettingsByUserIds: (ids: string[]) => Promise<Map<string, SettingLike[]>>
  createBulkNotifications: (input: Record<string, unknown>) => Promise<unknown>
  hasRecentSystemNotice: (kind: string, since: Date) => Promise<boolean>
  sendEmail: (mail: { to: string; subject: string; html: string }) => Promise<unknown>
  isMailConfigured: () => boolean
  log: {
    info: (msg: string, meta?: unknown) => void
    warn: (msg: string, meta?: unknown) => void
    error: (msg: string, meta?: unknown) => void
  }
}

const realDeps: NotifyStuckDeps = {
  listAdminRecipients,
  getUserSettingsByUserIds,
  createBulkNotifications: input => createBulkNotifications(input as never),
  hasRecentSystemNotice,
  sendEmail,
  isMailConfigured: () =>
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0,
  log,
}

/** 공지 문안. 주문번호는 다섯 개까지만 싣는다 — 나머지는 건수로 말한다. */
export function buildStuckPaymentsNotice(input: StuckPaymentsInput): {
  title: string
  message: string
  url: string | null
  cta: string | null
  data: Record<string, unknown>
} {
  const shown = input.orderIds.slice(0, 5)
  const more = input.count > shown.length ? ` 외 ${input.count - shown.length}건` : ''
  return {
    title: `결제 결과를 확인하지 못한 ${input.label}이(가) 있습니다`,
    message:
      `대사가 스스로 판정하지 못한 ${input.label} 결제가 ${input.count}건 있습니다. ` +
      `${input.action} ` +
      `주문번호: ${shown.join(', ')}${more}`,
    url: null,
    cta: null,
    data: { kind: input.kind, count: input.count },
  }
}

export async function notifyStuckPayments(
  input: StuckPaymentsInput,
  overrides?: Partial<NotifyStuckDeps>
): Promise<void> {
  const d = overrides ? { ...realDeps, ...overrides } : realDeps
  try {
    if (!(input.count > 0)) return

    const since = new Date(Date.now() - STUCK_NOTICE_WINDOW_MS)
    if (await d.hasRecentSystemNotice(input.kind, since)) {
      d.log.info('결제 확인 공지를 하루 안에 이미 냈으므로 다시 내지 않음', {
        kind: input.kind,
        count: input.count,
      })
      return
    }

    const admins = await d.listAdminRecipients()
    if (admins.length === 0) {
      d.log.warn('결제 확인 공지를 받을 관리자가 없음', { kind: input.kind, count: input.count })
      return
    }

    const notice = buildStuckPaymentsNotice(input)

    try {
      await d.createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'system_notice',
        title: notice.title,
        message: notice.message,
        data: notice.data,
        expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
      })
    } catch (error) {
      d.log.error('결제 확인 공지 일괄 생성 실패', {
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (!d.isMailConfigured()) return
    const settings = await d
      .getUserSettingsByUserIds(admins.map(a => a.id))
      .catch(() => new Map<string, SettingLike[]>())
    const { subject, html } = renderNoticeEmail(notice)
    const result = await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail: d.sendEmail,
      isOptedOut: id => isEmailOptedOut(settings.get(id)),
      log: d.log,
    })
    d.log.info('결제 확인 공지 발송', { kind: input.kind, count: input.count, ...result })
  } catch (error) {
    d.log.error('결제 확인 공지 실패', {
      kind: input.kind,
      count: input.count,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
