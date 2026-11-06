/**
 * 운영 경보를 **관리자에게** 보낸다 — 인앱 알림 + 메일.
 *
 * **왜 웹훅이 아닌가**: 이 사이트는 Slack·Discord·Google Chat 을 쓰지 않는다(2026-11-06 확인). 그래서
 * `SECURITY_ALERT_WEBHOOK_URL` 기반 경보는 실제로는 한 번도 나가지 않았고, 'high' 이벤트가 닿는 곳은 Vercel 런타임
 * 로그 한 줄(보존 1일)뿐이었다 — 크론이 멈춰도 아무도 몰랐다. 이미 쓰고 있는 두 통로로 보낸다: 사이트 안 알림과
 * Resend 메일. 둘 다 실패해도 던지지 않는다(경보가 본 작업을 깨면 안 된다).
 *
 * **같은 사실을 반복해서 알리지 않는다**: 크론 감시자는 매시 같은 문제를 다시 발견한다. 그래서 `dedupe`를 켜면
 * 같은 종류(`kind`)를 `OPS_ALERT_DEDUPE_MS` 안에 이미 알린 경우 건너뛴다(결제 정체 알림과 같은 방식 —
 * `hasRecentSystemNotice`). 되돌릴 수 없는 일(문서 대량 삭제)은 dedupe 없이 그때그때 보낸다.
 */
import { createBulkNotifications, hasRecentSystemNotice } from '@/db/queries/notifications'
import { listAdminRecipients } from '@/db/queries/profiles'
import { sendEmail } from '@/lib/mail/send'
import { createLogger } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'

const log = createLogger('lib/server/opsAlert')

/** 같은 종류의 경보를 다시 보내기까지의 최소 간격 */
export const OPS_ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000

export type OpsAlertInput = {
  /** 같은 종류를 묶는 이름 — `data.kind`로 저장되고 dedupe 판정에 쓰인다 */
  kind: string
  title: string
  message: string
  /** 알림/메일에서 눌러 갈 곳(사이트 상대 경로). 없으면 관리자 홈 */
  url?: string
  data?: Record<string, unknown>
  /** true면 최근 6시간 안에 같은 kind를 알렸을 때 건너뛴다 */
  dedupe?: boolean
}

export type OpsAlertResult = 'sent' | 'skipped' | 'failed'

export interface OpsAlertDeps {
  listAdminRecipients: () => Promise<{ id: string; email: string | null }[]>
  createBulkNotifications: (input: Record<string, unknown>) => Promise<unknown>
  hasRecentSystemNotice: (kind: string, since: Date) => Promise<boolean>
  sendEmail: (mail: { to: string; subject: string; html: string }) => Promise<unknown>
  isMailConfigured: () => boolean
  now: () => Date
  log: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }
}

const realDeps: OpsAlertDeps = {
  listAdminRecipients,
  createBulkNotifications: input => createBulkNotifications(input as never),
  hasRecentSystemNotice,
  sendEmail,
  isMailConfigured: () =>
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0,
  now: () => new Date(),
  log: { info: (m, meta) => log.info(m, meta), warn: (m, meta) => log.warn(m, meta) },
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 메일 본문 — 줄바꿈을 살린다. 링크는 상대 경로를 사이트 주소에 붙인다. */
export function buildOpsAlertEmail(input: OpsAlertInput, siteUrl: string): string {
  const link = `${siteUrl}${input.url ?? '/ko/admin'}`
  const body = escapeHtml(input.message).replace(/\n/g, '<br />')
  return (
    `<p><strong>${escapeHtml(input.title)}</strong></p>` +
    `<p>${body}</p>` +
    `<p><a href="${escapeHtml(link)}">사이트에서 열기</a></p>`
  )
}

/**
 * 관리자에게 경보를 보낸다. 던지지 않는다 — 실패는 로그로만 남긴다.
 *
 * 반환값은 테스트·로그용: `skipped`(dedupe) / `sent`(인앱이라도 남음) / `failed`(관리자 없음·인앱 실패).
 */
export async function alertOpsAdmins(
  input: OpsAlertInput,
  overrides?: Partial<OpsAlertDeps>
): Promise<OpsAlertResult> {
  const d = overrides ? { ...realDeps, ...overrides } : realDeps
  try {
    if (input.dedupe === true) {
      const since = new Date(d.now().getTime() - OPS_ALERT_DEDUPE_MS)
      if (await d.hasRecentSystemNotice(input.kind, since)) {
        d.log.info('같은 운영 경보를 최근에 이미 냈다 — 건너뛴다', { kind: input.kind })
        return 'skipped'
      }
    }

    const admins = await d.listAdminRecipients()
    if (admins.length === 0) {
      d.log.warn('운영 경보를 받을 관리자가 없다', { kind: input.kind })
      return 'failed'
    }

    const data = { ...(input.data ?? {}), kind: input.kind }
    try {
      await d.createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'system_notice',
        title: input.title,
        message: input.message,
        data,
        expires_at: new Date(d.now().getTime() + 30 * 86_400_000).toISOString(),
      })
    } catch (error) {
      d.log.warn('운영 경보 인앱 알림 실패', {
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!d.isMailConfigured()) return 'failed'
    }

    if (!d.isMailConfigured()) return 'sent'

    const siteUrl = getSiteUrl().replace(/\/$/, '')
    const html = buildOpsAlertEmail(input, siteUrl)
    for (const admin of admins) {
      if (!admin.email) continue
      try {
        await d.sendEmail({
          to: admin.email,
          subject: `[경기아트콜렉티브 운영] ${input.title}`,
          html,
        })
      } catch (error) {
        d.log.warn('운영 경보 메일 실패', {
          kind: input.kind,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return 'sent'
  } catch (error) {
    d.log.warn('운영 경보 전송 실패', {
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}
