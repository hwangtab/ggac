/**
 * 예술지원사업 주간 초안 생성 (크론 전용).
 *
 * 판단 로직은 `src/lib/server/grantDigest.ts`에 있고 여기는 **배선만** 한다.
 * 인증은 기존 크론들(`/api/internal/dues/charge`)과 같은 방식 — 공유 토큰을 타이밍 안전 비교.
 *
 * **이 라우트는 조합원에게 아무것도 보내지 않는다.** 초안을 만들고 관리자에게만 알린다.
 * 발행은 사람이 `/admin/grants`에서 누른다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  createGrantDigest,
  getGrantDigestByWeekKey,
  listRecentDigestItems,
} from '@/db/queries/grantDigests'
import { createBulkNotifications } from '@/db/queries/notifications'
import { listProfiles } from '@/db/queries/profiles'
import { fetchGrantOpportunities } from '@/lib/server/grantFetch'
import { DEDUPE_WEEKS, buildDraftItems, weekKey } from '@/lib/server/grantDigest'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/grant-digest/draft')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.GRANT_DIGEST_CRON_TOKEN
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/** 관리자 프로필 id 목록. 알림 대상이다. */
async function adminUserIds(): Promise<string[]> {
  const { rows } = await listProfiles({ status: 'approved', limit: 1000, offset: 0 })
  return rows.filter(r => r.is_admin && r.is_active).map(r => r.id)
}

/** 관리자에게만 알린다. 실패해도 던지지 않는다 — 초안은 이미 만들어졌다. */
async function notifyAdmins(title: string, message: string, data: Record<string, unknown>) {
  try {
    const ids = await adminUserIds()
    if (ids.length === 0) {
      log.error('관리자 알림 대상이 없다', { title })
      return
    }
    await createBulkNotifications({
      user_ids: ids,
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

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }

  const key = weekKey()

  try {
    const existing = await getGrantDigestByWeekKey(key)
    if (existing) {
      // 크론이 두 번 돌았거나 수동으로 이미 만들었다. 덮어쓰지 않는다 —
      // 관리자가 편집한 내용이 사라지면 안 된다.
      log.info('이미 있는 회차라 건너뛴다', { weekKey: key, digestId: existing.id })
      return ApiSuccess.ok({
        skipped: true,
        week_key: key,
        digest_id: existing.id,
      }).toNextResponse()
    }

    const fetched = await fetchGrantOpportunities()
    const sentKeys = new Set((await listRecentDigestItems(DEDUPE_WEEKS)).map(i => i.key))
    const items = buildDraftItems(fetched, sentKeys)

    const digest = await createGrantDigest({ week_key: key, items })

    await notifyAdmins(
      '지원사업 초안이 준비됐습니다',
      `${key} 회차에 공고 ${items.length}건이 담겼습니다. 관리자 > 지원사업에서 확인하고 발행해 주세요.`,
      { weekKey: key, digestId: digest.id, count: items.length }
    )

    log.info('초안 생성 완료', { weekKey: key, fetched: fetched.length, kept: items.length })
    return ApiSuccess.created({
      digest_id: digest.id,
      week_key: key,
      fetched: fetched.length,
      kept: items.length,
    }).toNextResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('초안 생성 실패', { weekKey: key, error: message })
    // 조합원에게는 아무 일도 일어나지 않는다. 관리자만 안다.
    await notifyAdmins(
      '지원사업 초안 생성에 실패했습니다',
      `${key} 회차 초안을 만들지 못했습니다. 원인: ${message.slice(0, 200)}`,
      { weekKey: key }
    )
    return ApiError.internalServerError('초안 생성에 실패했습니다.').toNextResponse()
  }
}
