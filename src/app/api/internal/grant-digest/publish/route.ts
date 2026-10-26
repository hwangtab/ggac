/**
 * 예술지원사업 주간 회차 자동 발행 (크론 전용).
 *
 * 초안 크론(`../draft`)이 월요일 아침에 만든 회차를 같은 날 오후에 내보낸다. 인증은 초안과
 * 같은 `GRANT_DIGEST_CRON_TOKEN`이다. 발행 절차는 관리자 화면과 같은 코드
 * (`publishClaimedDigest`)를 쓴다.
 *
 * **메일은 회수되지 않으므로 보수적으로 멈춘다.** 아래 중 하나면 아무것도 보내지 않고
 * 관리자에게 알린 뒤 `blocked`로 응답한다(워크플로가 실패로 표시한다). 그 주는 사람이 본다.
 *  - 회차가 없다 / 이미 발행·폐기됐다(후자는 정상 건너뜀)
 *  - 발행할 공고 0건·마감 지난 공고 혼입 (`autoPublishBlockers`). 신규가 많은 주는 막지 않는다
 *  - 게시판 기능이 꺼져 있다 / 게시글 작성자 계정을 못 찾는다
 * 관리자가 이번 주를 직접 검수하려면 회차를 **폐기**하면 된다 — 'draft'가 아니면 건너뛴다.
 *
 * `?dry=1`이면 판정까지만 하고 선점도 발송도 하지 않는다. 워크플로는 저장소 변수
 * `GRANT_AUTO_PUBLISH`가 `true`일 때만 실제 발행을 요청한다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { claimGrantDigestForPublish, getGrantDigestByWeekKey } from '@/db/queries/grantDigests'
import { listProfiles, type ProfileRow } from '@/db/queries/profiles'
import { isBoardEnabled } from '@/lib/features/settings'
import { adminUserIds, notifyAdmins } from '@/lib/server/grantAdminNotify'
import {
  activeItems,
  autoPublishBlockers,
  kstTodayIso,
  weekKey as currentWeekKey,
} from '@/lib/server/grantDigest'
import { MEMBER_FETCH_LIMIT, publishClaimedDigest } from '@/lib/server/grantPublishWiring'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/grant-digest/publish')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 순차 메일 발송 + 게시글 + 알림. 관리자 발행 라우트와 같은 값이다. */
export const maxDuration = 300

/** 게시글 작성자. 회차 글은 개인이 아니라 조합 공식 계정 명의로 나간다. */
const DEFAULT_AUTHOR_EMAIL = 'contact@ggac.kr'

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.GRANT_DIGEST_CRON_TOKEN
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }

  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const key = currentWeekKey()
  let profiles: ProfileRow[] | null = null

  try {
    const { rows } = await listProfiles({
      status: 'approved',
      limit: MEMBER_FETCH_LIMIT,
      offset: 0,
    })
    profiles = rows
    const admins = adminUserIds(rows)

    const digest = await getGrantDigestByWeekKey(key)
    if (!digest) {
      // 초안 크론이 실패했거나 아직 안 돌았다. 조용히 넘기면 이번 주가 통째로 사라진다.
      await notifyAdmins(
        admins,
        '지원사업 자동 발행을 하지 못했습니다',
        `${key} 회차가 없습니다. 초안 생성이 실패했는지 확인해 주세요.`,
        { weekKey: key }
      )
      return ApiError.notFound(`${key} 회차가 없습니다.`).toNextResponse()
    }
    if (digest.status !== 'draft') {
      // 이미 발행했거나(수동 발행 포함) 관리자가 폐기했다. 정상이다.
      log.info('draft가 아니라 건너뛴다', { weekKey: key, status: digest.status })
      return ApiSuccess.ok({
        skipped: true,
        week_key: key,
        status: digest.status,
      }).toNextResponse()
    }

    const active = activeItems(digest.items)
    const freshCount = active.filter(i => i.is_new === true).length
    const reasons = autoPublishBlockers(digest.items, kstTodayIso())

    if ((await isBoardEnabled()) === false) {
      reasons.push('게시판 기능이 꺼져 있어 게시글을 만들 수 없습니다.')
    }
    const authorEmail = process.env.GRANT_DIGEST_AUTHOR_EMAIL || DEFAULT_AUTHOR_EMAIL
    const author = rows.find(r => r.email === authorEmail && r.is_admin && r.is_active)
    if (!author) reasons.push(`게시글 작성자 계정(${authorEmail})을 관리자로 찾을 수 없습니다.`)

    if (reasons.length > 0 || !author) {
      if (!dry) {
        await notifyAdmins(
          admins,
          '지원사업 자동 발행을 멈췄습니다',
          `${key} 회차를 보내지 않았습니다. ${reasons.join(' ')} ` +
            `관리자 > 지원사업에서 확인하고 직접 발행해 주세요.`,
          { weekKey: key, digestId: digest.id, reasons }
        )
      }
      log.info('자동 발행 보류', { weekKey: key, reasons, dry })
      return ApiSuccess.ok({
        blocked: true,
        dry,
        week_key: key,
        digest_id: digest.id,
        reasons,
      }).toNextResponse()
    }

    if (dry) {
      return ApiSuccess.ok({
        dry: true,
        would_publish: true,
        week_key: key,
        digest_id: digest.id,
        items: active.length,
        new_count: freshCount,
      }).toNextResponse()
    }

    // draft → publishing 조건부 선점. 크론이 겹치거나 관리자가 동시에 눌러도 하나만 통과한다.
    const claimed = await claimGrantDigestForPublish(digest.id)
    if (!claimed) {
      return ApiSuccess.ok({ skipped: true, week_key: key, status: 'publishing' }).toNextResponse()
    }

    const result = await publishClaimedDigest({
      claimed,
      authorId: author.id,
      actor: 'cron',
    })

    await notifyAdmins(
      admins,
      '지원사업을 자동 발행했습니다',
      `${key} 회차를 발행했습니다. 공고 ${result.post_item_count}건 · 알림 ${result.notified}명 · ` +
        `메일 ${result.email_sent}통 성공${result.email_failed > 0 ? ` · 실패 ${result.email_failed}통` : ''}.`,
      {
        weekKey: key,
        digestId: digest.id,
        postId: result.post_id,
        email_sent: result.email_sent,
        email_failed: result.email_failed,
      }
    )

    return ApiSuccess.ok({
      published: true,
      week_key: key,
      digest_id: digest.id,
      post_id: result.post_id,
      email_sent: result.email_sent,
      email_failed: result.email_failed,
    }).toNextResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('자동 발행 실패', { weekKey: key, error: message })
    let adminIds: string[] = []
    try {
      const rows =
        profiles ??
        (await listProfiles({ status: 'approved', limit: MEMBER_FETCH_LIMIT, offset: 0 })).rows
      adminIds = adminUserIds(rows)
    } catch {
      // 알림 대상을 못 구하면 로그만 남는다. 워크플로가 5xx로 실패 표시한다.
    }
    await notifyAdmins(
      adminIds,
      '지원사업 자동 발행에 실패했습니다',
      `${key} 회차 발행 중 오류가 났습니다. 일부 메일이 이미 나갔을 수 있으니 ` +
        `다시 발행하기 전에 관리자 > 지원사업에서 상태를 확인해 주세요. 원인: ${message.slice(0, 200)}`,
      { weekKey: key }
    )
    return ApiError.internalServerError('자동 발행에 실패했습니다.').toNextResponse()
  }
}
