/**
 * 예술지원사업 주간 회차 자동 발행 (크론 전용).
 *
 * 초안 크론(`../draft`, GitHub Actions 월 08:00)이 만든 회차를 같은 날 오후에 내보낸다.
 * 발행 절차는 관리자 화면과 같은 코드(`publishClaimedDigest`)를 쓴다.
 *
 * 부르는 길이 둘이다.
 *  - **GET — Vercel Cron** (`vercel.json`, 월 17:17·예비 20:17 KST). `CRON_SECRET` Bearer.
 *    실제로 보낼지는 Vercel 환경변수 `GRANT_AUTO_PUBLISH === 'true'`로 정하고, 아니면
 *    드라이런이다. GitHub 예약 실행이 아닌 이유: 실측 7시간 늦게 돌아(17:17 예정이 다음 날
 *    00:15) 메일이 자정을 넘기고, 날짜가 바뀌면 판정도 어긋난다.
 *  - **POST — 손으로 부를 때** (GitHub `grant-digest-publish` 수동 실행). 초안과 같은
 *    `GRANT_DIGEST_CRON_TOKEN`. `?dry=1`이면 드라이런이다. 환경변수와 무관하다.
 *
 * **메일은 회수되지 않으므로 보수적으로 멈춘다.** 아래 중 하나면 아무것도 보내지 않고
 * 관리자에게 알린 뒤 `blocked`로 응답한다. 그 주는 사람이 본다.
 *  - 회차가 없다 / 'publishing'에 남아 있다(도중에 죽은 발행일 수 있다). 발행된 회차는 정상 건너뜀
 *  - 발행할 공고 0건·게시글 0건·마감 지난 공고 혼입 (`contentBlockers`). 신규가 많은 주는 막지 않는다
 *  - 게시판 기능이 꺼져 있다 / 게시글 작성자 계정을 못 찾는다
 * 이번 주만 보내지 않으려면 관리자 > 지원사업에서 공고를 전부 제외한다("발행할 공고 없음"으로
 * 멈춘다). 아예 끄려면 `GRANT_AUTO_PUBLISH`를 지우고 재배포한다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  claimGrantDigestForPublish,
  getGrantDigestByWeekKey,
  updateGrantDigest,
  type GrantItem,
} from '@/db/queries/grantDigests'
import { listProfiles, type ProfileRow } from '@/db/queries/profiles'
import { isBoardEnabled } from '@/lib/features/settings'
import { adminUserIds, alertAdmins, notifyAdmins } from '@/lib/server/grantAdminNotify'
import {
  activeItems,
  autoPublishBlockers,
  kstTodayIso,
  weekKey as currentWeekKey,
} from '@/lib/server/grantDigest'
import { MEMBER_FETCH_LIMIT, publishClaimedDigest } from '@/lib/server/grantPublishWiring'
import { filterByDefaultInterests } from '@/lib/server/interestMatch'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/grant-digest/publish')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 순차 메일 발송 + 게시글 + 알림. 관리자 발행 라우트와 같은 값이다. */
export const maxDuration = 300

/** 게시글 작성자. 회차 글은 개인이 아니라 조합 공식 계정 명의로 나간다. */
const DEFAULT_AUTHOR_EMAIL = 'contact@ggac.kr'

function bearerMatches(request: NextRequest, expected: string | undefined): boolean {
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/**
 * 회차 내용만으로 정하는 멈춤 사유. 선점 **전과 후에 두 번** 본다 — 그 사이 관리자 편집이
 * 끼면 선점된 items가 처음 읽은 것과 다를 수 있다.
 *
 * 마감 지난 공고는 **초안을 만든 날** 기준으로 센다. 실행 시각 기준이면 발행이 자정을 넘긴
 * 날 월요일 마감(D-0) 공고가 "마감 지남"이 되어 그 주가 통째로 멈춘다. 이 판정은 수집이
 * 이상한 데이터를 받았는지 보는 것이지, 발송 시각의 D-day를 따지는 것이 아니다.
 *
 * 게시글·인앱 알림은 조합 기본 관심사로 좁힌 목록을 쓴다(`runGrantPublish`). 활성 항목이
 * 있어도 기본 관심사를 통과하는 것이 0건이면 "0건" 게시글과 빈 알림이 전원에게 나간다.
 */
function contentBlockers(items: GrantItem[], draftDayIso: string): string[] {
  const reasons = autoPublishBlockers(items, draftDayIso)
  const active = activeItems(items)
  if (active.length > 0 && filterByDefaultInterests(active).length === 0) {
    reasons.push('조합 기본 관심사에 맞는 공고가 없어 게시글이 0건이 됩니다.')
  }
  return reasons
}

/** Vercel Cron. 실제 발송 여부는 환경변수로만 정한다. */
export async function GET(request: NextRequest) {
  if (!bearerMatches(request, process.env.CRON_SECRET)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return run(process.env.GRANT_AUTO_PUBLISH !== 'true')
}

/** 손으로 부를 때. `?dry=1`이면 드라이런. */
export async function POST(request: NextRequest) {
  if (!bearerMatches(request, process.env.GRANT_DIGEST_CRON_TOKEN)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return run(request.nextUrl.searchParams.get('dry') === '1')
}

async function run(dry: boolean) {
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
      await alertAdmins(
        rows,
        '지원사업 자동 발행을 하지 못했습니다',
        `${key} 회차가 없습니다. 초안 생성이 실패했는지 확인해 주세요.`,
        { weekKey: key }
      )
      return ApiError.notFound(`${key} 회차가 없습니다.`).toNextResponse()
    }
    if (digest.status === 'publishing') {
      // 발행이 도중에 죽었을 수 있다(maxDuration에 걸리면 catch도 못 돈다). 일부 메일이
      // 나갔을 수 있어 다시 보내면 안 되고, 조용히 넘기면 아무도 모른다 — 사람을 부른다.
      // 관리자가 바로 지금 발행 버튼을 누른 경우에도 이 알림이 갈 수 있다. 그때는 무시하면 된다.
      if (!dry) {
        await alertAdmins(
          rows,
          '지원사업 회차가 발행 중 상태로 남아 있습니다',
          `${key} 회차가 'publishing' 상태라 자동 발행이 손대지 않았습니다. 방금 직접 발행한 ` +
            `것이 아니라면 발행이 도중에 멈춘 것입니다. 일부 메일이 나갔을 수 있으니 다시 ` +
            `발행하지 말고 발송 기록을 확인해 주세요.`,
          { weekKey: key, digestId: digest.id }
        )
      }
      return ApiSuccess.ok({
        blocked: true,
        dry,
        week_key: key,
        reasons: ["회차가 'publishing' 상태입니다."],
      }).toNextResponse()
    }
    if (digest.status !== 'draft') {
      // 이미 발행했다(관리자가 먼저 눌렀거나 수동 스크립트). 정상이다.
      log.info('draft가 아니라 건너뛴다', { weekKey: key, status: digest.status })
      return ApiSuccess.ok({
        skipped: true,
        week_key: key,
        status: digest.status,
      }).toNextResponse()
    }

    const active = activeItems(digest.items)
    const freshCount = active.filter(i => i.is_new === true).length
    const draftDayIso = kstTodayIso(new Date(digest.created_at))
    const reasons = contentBlockers(digest.items, draftDayIso)

    if ((await isBoardEnabled()) === false) {
      reasons.push('게시판 기능이 꺼져 있어 게시글을 만들 수 없습니다.')
    }
    const authorEmail = process.env.GRANT_DIGEST_AUTHOR_EMAIL || DEFAULT_AUTHOR_EMAIL
    const author = rows.find(
      r =>
        r.email?.toLowerCase() === authorEmail.toLowerCase() &&
        r.is_admin &&
        r.is_active &&
        !r.is_suspended
    )
    // 사유 문구는 공개 Actions 로그에 찍힌다 — 주소는 관리자 알림에만 적는다.
    if (!author) reasons.push('게시글 작성자 계정을 활성 관리자로 찾을 수 없습니다.')

    if (reasons.length > 0 || !author) {
      if (!dry) {
        await alertAdmins(
          rows,
          '지원사업 자동 발행을 멈췄습니다',
          `${key} 회차를 보내지 않았습니다. ${reasons.join(' ')} ` +
            (author ? '' : `(작성자 설정: ${authorEmail}) `) +
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
    // 처음 읽은 뒤 선점 전에 관리자 편집이 끼었을 수 있다 — 실제로 나갈 items로 다시 본다.
    const lateReasons = contentBlockers(claimed.items, draftDayIso)
    if (lateReasons.length > 0) {
      await updateGrantDigest(claimed.id, { status: 'draft' })
      await alertAdmins(
        rows,
        '지원사업 자동 발행을 멈췄습니다',
        `${key} 회차를 보내지 않았습니다. ${lateReasons.join(' ')} ` +
          `관리자 > 지원사업에서 확인하고 직접 발행해 주세요.`,
        { weekKey: key, digestId: claimed.id, reasons: lateReasons }
      )
      return ApiSuccess.ok({
        blocked: true,
        dry: false,
        week_key: key,
        reasons: lateReasons,
      }).toNextResponse()
    }

    const result = await publishClaimedDigest({
      claimed,
      authorId: author.id,
      actor: 'cron',
    })

    // 평소 소식은 인앱 알림만, 메일 실패가 있으면 경보(메일 포함)로 보낸다.
    const tell = (title: string, message: string, data: Record<string, unknown>) =>
      result.email_failed > 0
        ? alertAdmins(rows, title, message, data)
        : notifyAdmins(admins, title, message, data)
    await tell(
      result.email_failed > 0
        ? '지원사업을 자동 발행했지만 메일 일부가 실패했습니다'
        : '지원사업을 자동 발행했습니다',
      `${key} 회차를 발행했습니다. 공고 ${result.post_item_count}건 · 알림 ${result.notified}명 · ` +
        `메일 ${result.email_sent}통 성공` +
        (result.email_failed > 0
          ? ` · 실패 ${result.email_failed}통. 다시 발행하면 성공한 분께 메일이 두 번 갑니다 — ` +
            `재발행하지 말고 메일 발송 상태(Resend)를 확인해 주세요.`
          : '.'),
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
    let rows: ProfileRow[] = []
    try {
      rows =
        profiles ??
        (await listProfiles({ status: 'approved', limit: MEMBER_FETCH_LIMIT, offset: 0 })).rows
    } catch {
      // 알림 대상을 못 구하면 로그만 남는다.
    }
    await alertAdmins(
      rows,
      '지원사업 자동 발행에 실패했습니다',
      `${key} 회차 발행 중 오류가 났습니다. 일부 메일이 이미 나갔을 수 있으니 ` +
        `다시 발행하기 전에 관리자 > 지원사업에서 상태를 확인해 주세요. 원인: ${message.slice(0, 200)}`,
      { weekKey: key }
    )
    return ApiError.internalServerError('자동 발행에 실패했습니다.').toNextResponse()
  }
}
