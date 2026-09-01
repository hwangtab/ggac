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
import { listProfiles, type ProfileRow } from '@/db/queries/profiles'
import { fetchGrantOpportunities } from '@/lib/server/grantFetch'
import { DEDUPE_WEEKS, POOL_CAP, buildDraftItems, weekKey } from '@/lib/server/grantDigest'
import { unionInterests } from '@/lib/server/interestMatch'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/grant-digest/draft')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 장르별 kosmart 호출은 병렬이지만(`fetchGrantOpportunities`), 그 전후로 회원 목록
 * 조회·DB 쓰기·관리자 알림이 있다. kosmart가 느린 날엔 병렬 호출 전체가 가장 느린
 * 장르 하나만큼 걸리고(`AbortSignal.timeout` 20초), 조합원이 늘면 그 뒤 단계도
 * 늘어난다. `/api/internal/dues/charge`(같은 저장소, `maxDuration = 800`)와 같은
 * 이유로 여유를 둔다 — 지금 필요한 시간보다 넉넉히 잡아 시간 초과로 인한 "조용한 실패"
 * (Vercel이 프로세스를 죽여 catch도 못 돌고 관리자 알림도 못 가는 상태)를 막는다.
 */
export const maxDuration = 300

/** 수집 범위(관심사 합집합)와 관리자 목록을 함께 낼 때 쓰는 회원 조회 상한. */
const MEMBER_FETCH_LIMIT = 1000

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.GRANT_DIGEST_CRON_TOKEN
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/** 이미 읽은 회원 목록에서 관리자 id만 거른다. 알림 대상이다. */
function adminUserIds(rows: ProfileRow[]): string[] {
  return rows.filter(r => r.is_admin && r.is_active).map(r => r.id)
}

/** 관리자에게만 알린다. 실패해도 던지지 않는다 — 초안은 이미 만들어졌다(혹은 실패가 이미 확정됐다). */
async function notifyAdmins(
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

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }

  const key = weekKey()
  // 성공 경로에서 이미 읽은 회원 목록을 catch에서도 재사용한다. 목록 조회 자체가
  // 실패하면 이 값은 계속 null이고, catch에서 관리자 id만 다시 조회한다.
  let profiles: ProfileRow[] | null = null

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

    // 수집 범위는 조합 기본값과 조합원 설정의 합집합이다. 아무도 설정하지 않았으면
    // 조합 기본값만 남아 지금까지와 똑같이 동작한다.
    const { rows } = await listProfiles({
      status: 'approved',
      limit: MEMBER_FETCH_LIMIT,
      offset: 0,
    })
    profiles = rows
    const active = rows.filter(p => p.is_active)
    const scope = unionInterests(active)

    const fetched = await fetchGrantOpportunities(scope)
    const sentKeys = new Set((await listRecentDigestItems(DEDUPE_WEEKS)).map(i => i.key))
    const items = buildDraftItems(fetched, sentKeys, POOL_CAP)

    const digest = await createGrantDigest({ week_key: key, items })

    await notifyAdmins(
      adminUserIds(profiles),
      '지원사업 초안이 준비됐습니다',
      `${key} 회차에 공고 ${items.length}건이 담겼습니다. ` +
        `(수집 범위: 장르 ${scope.genres.length}종 · 지역 ${scope.regions.length}곳) ` +
        `관리자 > 지원사업에서 확인하고 발행해 주세요.`,
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

    // 조합원에게는 아무 일도 일어나지 않는다. 관리자만 안다 — 그러니 이 경로에서도
    // 반드시 알림이 가야 한다. 위에서 회원 목록을 이미 읽었으면 그걸 쓰고, 못 읽었으면
    // (목록 조회 자체가 실패 원인이었을 수 있다) 관리자 id만 다시 조회한다.
    let adminIds: string[]
    if (profiles) {
      adminIds = adminUserIds(profiles)
    } else {
      try {
        const { rows } = await listProfiles({
          status: 'approved',
          limit: MEMBER_FETCH_LIMIT,
          offset: 0,
        })
        adminIds = adminUserIds(rows)
      } catch (retryError) {
        log.error('관리자 알림 대상 재조회 실패', {
          weekKey: key,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        adminIds = []
      }
    }

    await notifyAdmins(
      adminIds,
      '지원사업 초안 생성에 실패했습니다',
      `${key} 회차 초안을 만들지 못했습니다. 원인: ${message.slice(0, 200)}`,
      { weekKey: key }
    )
    return ApiError.internalServerError('초안 생성에 실패했습니다.').toNextResponse()
  }
}
