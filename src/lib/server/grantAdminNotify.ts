/**
 * 지원사업 크론이 관리자에게만 알리는 공용 헬퍼 (초안 생성·자동 발행).
 *
 * 평소 소식(초안 준비·발행 완료)은 인앱 알림만 보낸다. **사람이 손대야 하는 일**(멈춤·실패)은
 * `alertAdmins`로 메일도 보낸다 — 크론은 Vercel Cron이라 실패해도 아무도 메일을 받지 않고,
 * 인앱 알림은 관리자가 사이트에 들어와야 보인다. 그러면 그 주가 조용히 빠진다.
 */
import { createBulkNotifications } from '@/db/queries/notifications'
import type { ProfileRow } from '@/db/queries/profiles'
import { sendEmail } from '@/lib/mail/send'
import { createLogger } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'

const log = createLogger('lib/server/grantAdminNotify')

/** 이미 읽은 회원 목록에서 관리자 id만 거른다. 알림 대상이다. */
export function adminUserIds(rows: ProfileRow[]): string[] {
  return rows.filter(r => r.is_admin && r.is_active).map(r => r.id)
}

/** 관리자에게만 알린다. 실패해도 던지지 않는다 — 알림이 본 작업을 깨면 안 된다. */
export async function notifyAdmins(
  adminIds: string[],
  title: string,
  message: string,
  data: Record<string, unknown>
) {
  try {
    if (adminIds.length === 0) {
      log.error('관리자 알림 대상이 없다', { title })
      return
    }
    await createBulkNotifications({
      user_ids: adminIds,
      type: 'system_notice',
      title,
      message,
      data,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })
  } catch (error) {
    log.error('관리자 알림 생성 실패', {
      title,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 사람이 손대야 하는 일을 알린다 — 인앱 알림과 관리자 메일 둘 다. 어느 쪽이 실패해도
 * 던지지 않는다. Resend 자체가 원인(키 만료)이면 메일은 못 가고 인앱 알림만 남는다.
 */
export async function alertAdmins(
  rows: ProfileRow[],
  title: string,
  message: string,
  data: Record<string, unknown>
) {
  const admins = rows.filter(r => r.is_admin && r.is_active)
  await notifyAdmins(
    admins.map(r => r.id),
    title,
    message,
    data
  )
  const link = `${getSiteUrl()}/ko/admin/grants`
  const html =
    `<p>${escapeHtml(message)}</p>` +
    `<p><a href="${escapeHtml(link)}">관리자 &gt; 지원사업 열기</a></p>`
  for (const a of admins) {
    if (!a.email) continue
    try {
      await sendEmail({ to: a.email, subject: `[경기아트콜렉티브 관리] ${title}`, html })
    } catch (error) {
      log.error('관리자 경보 메일 실패', {
        title,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
