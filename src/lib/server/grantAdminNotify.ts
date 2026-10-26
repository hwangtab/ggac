/**
 * 지원사업 크론이 관리자에게만 알리는 공용 헬퍼 (초안 생성·자동 발행).
 */
import { createBulkNotifications } from '@/db/queries/notifications'
import type { ProfileRow } from '@/db/queries/profiles'
import { createLogger } from '@/utils/logger'

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
