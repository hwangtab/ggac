/**
 * 예술지원사업 주간 초안 생성 (크론 전용).
 *
 * 판단 로직은 `src/lib/server/grantDigest.ts`에 있고 여기는 **배선만** 한다.
 * 부르는 길: GET은 Vercel Cron(`CRON_SECRET`), POST는 GitHub Actions·수동(`GRANT_DIGEST_CRON_TOKEN`).
 * 둘 다 같은 일을 하고, 이미 있는 회차는 건너뛴다.
 *
 * **이 라우트는 조합원에게 아무것도 보내지 않는다.** 초안을 만들고 관리자에게만 알린다.
 * 발행은 같은 날 17:17 KST에 `../publish`를 Vercel Cron이 부르거나(자동 발행이 켜져 있을 때) 관리자가
 * `/admin/grants`에서 누른다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  createGrantDigest,
  getGrantDigestByWeekKey,
  listRecentDigestItems,
} from '@/db/queries/grantDigests'
import { listProfiles, type ProfileRow } from '@/db/queries/profiles'
import { adminUserIds, alertAdmins, notifyAdmins } from '@/lib/server/grantAdminNotify'
import { fetchGrantOpportunities } from '@/lib/server/grantFetch'
import {
  DEDUPE_WEEKS,
  TITLE_DEDUPE_WEEKS,
  POOL_CAP,
  buildDraftItems,
  interleaveGenreBlocks,
  kstTodayIso,
  normalizedTitleKey,
  weekKey,
} from '@/lib/server/grantDigest'
import {
  countGenreUnclassified,
  filterByDefaultInterests,
  unionInterests,
} from '@/lib/server/interestMatch'
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

function bearerMatches(request: NextRequest, expected: string | undefined): boolean {
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/**
 * Vercel Cron(`vercel.json`, 월 09:00 KST).
 *
 * **시각은 kosmart 수집 뒤여야 한다.** kosmartweb은 공고를 매일 08:00 KST에 수집한다
 * (`crawl-opportunities`, 23:00 UTC, 최대 5분). 그 전에 가져가면 일요일 아침 수집분을 받아
 * 하루치 새 공고가 그 주에서 빠진다. 옛 GitHub 일정(08:00)도 수집과 같은 시각이었는데,
 * 매번 1~3시간 늦게 돌아 우연히 맞았을 뿐이다.
 *
 * GitHub 예약 실행은 실측 몇 시간씩 늦어(2026-10-26 발행 워크플로는 7시간) 17:17 자동 발행
 * 전에 초안이 없을 수 있다. 정해진 분에 도는 Vercel이 만들고, 늦게 오는 GitHub 실행은
 * "이미 있는 회차"로 건너뛴다.
 */
export async function GET(request: NextRequest) {
  if (!bearerMatches(request, process.env.CRON_SECRET)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return run()
}

/** GitHub Actions(`grant-digest-draft.yml`)와 손으로 부를 때. */
export async function POST(request: NextRequest) {
  if (!bearerMatches(request, process.env.GRANT_DIGEST_CRON_TOKEN)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return run()
}

async function run() {
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

    // 장르별 블록으로 받아 한 건씩 번갈아 섞는다 — 그래야 뒤 장르(음악 아닌 것)가
    // 조합 기본값(음악)에 밀려 매주 굶지 않는다. 블록이 하나뿐이면(지금처럼 아무도
    // 관심사를 설정하지 않은 상태) 순서가 원래 그대로 보존된다.
    const blocks = await fetchGrantOpportunities(scope)
    const fetched = interleaveGenreBlocks(blocks.map(b => b.items))
    // 중복 제거는 두 축이다: `key`(= source:source_id)와 정규화한 제목. 재공고는 새
    // source_id를 받으므로 key만으로는 안 잡힌다(실측: 양평문화자원 공모/재공고가 두 회차에
    // 걸쳐 게시글·메일·캘린더에 나란히 실렸다).
    // 두 축의 창이 다르다: key는 캘린더가 보는 26주 전체, 제목은 12주. 제목 축은
    // 근사라 서로 다른 사업을 같은 것으로 볼 수 있어(연례 공모는 해마다 제목이 거의
    // 같다) 창을 짧게 둔다.
    const recent = await listRecentDigestItems(DEDUPE_WEEKS)
    const recentForTitles = await listRecentDigestItems(TITLE_DEDUPE_WEEKS)
    const sentKeys = new Set(recent.map(i => i.key))
    const sentTitleKeys = new Set(
      recentForTitles.map(i => normalizedTitleKey(i.title)).filter(Boolean)
    )
    // `sentKeys`·`sentTitleKeys`는 이제 **버리는 기준이 아니라 표시하는 기준**이다 —
    // 이미 보낸 공고도 아직 접수 중이면 다시 싣고 `is_new: false`를 붙인다(국장 판정
    // 2026-09-14). 같은 응답 안의 중복만 버린다.
    const items = buildDraftItems(fetched, sentKeys, POOL_CAP, sentTitleKeys, kstTodayIso())
    const freshCount = items.filter(i => i.is_new).length
    const ongoingCount = items.length - freshCount

    // 게시글·인앱 알림은 개인화하지 않으므로 조합 기본 관심사로 좁혀 렌더된다
    // (`grantPublish.ts`). 관리자가 발행 전에 그 숫자를 알 수 있게 초안 알림에 함께 적는다.
    const forPost = filterByDefaultInterests(items).length
    const unclassified = countGenreUnclassified(items)

    const digest = await createGrantDigest({ week_key: key, items })

    await notifyAdmins(
      adminUserIds(profiles),
      '지원사업 초안이 준비됐습니다',
      `${key} 회차에 공고 ${items.length}건이 담겼습니다` +
        `(신규 ${freshCount} · 계속 접수 중 ${ongoingCount}). ` +
        `(그중 조합 기본 관심사로 게시글·알림에 실릴 것은 ${forPost}건) ` +
        // 장르 미분류는 판정에 안 쓰지만 **분류가 나빠지는 것을 사람이 알아채는 유일한 신호**다
        // (`interestMatch.ts`의 isGenreUnclassified 참고). 0건이면 굳이 적지 않는다.
        (unclassified > 0 ? `(장르 미분류 ${unclassified}건 포함) ` : '') +
        `(수집 범위: 장르 ${scope.genres.length}종 · 지역 ${scope.regions.length}곳) ` +
        `오늘 17시 이후 자동 발행됩니다(자동 발행이 켜져 있을 때). 뺄 공고가 있으면 그 전에 ` +
        `관리자 > 지원사업에서 제외해 주세요.`,
      {
        weekKey: key,
        digestId: digest.id,
        count: items.length,
        post_count: forPost,
        new_count: freshCount,
        ongoing_count: ongoingCount,
        unclassified_genre_count: unclassified,
      }
    )

    log.info('초안 생성 완료', {
      weekKey: key,
      fetched: fetched.length,
      kept: items.length,
      fresh: freshCount,
      ongoing: ongoingCount,
    })
    return ApiSuccess.created({
      digest_id: digest.id,
      week_key: key,
      fetched: fetched.length,
      kept: items.length,
    }).toNextResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('초안 생성 실패', { weekKey: key, error: message })

    // 두 크론(Vercel·GitHub)이 겹쳐 같은 주를 동시에 만들면 뒤쪽은 week_key 유일 인덱스에
    // 걸려 던진다. 그건 실패가 아니다 — 회차가 생겼으면 건너뜀으로 끝낸다(거짓 경보 방지).
    try {
      const raced = await getGrantDigestByWeekKey(key)
      if (raced) {
        log.info('다른 실행이 먼저 회차를 만들었다', { weekKey: key, digestId: raced.id })
        return ApiSuccess.ok({ skipped: true, week_key: key, digest_id: raced.id }).toNextResponse()
      }
    } catch {
      // 재조회도 실패하면 아래에서 실패로 알린다.
    }

    // 조합원에게는 아무 일도 일어나지 않는다. 관리자만 안다 — 그러니 이 경로에서도
    // 반드시 알림이 가야 한다(메일 포함 — 오후 자동 발행이 이 회차를 기다린다). 위에서
    // 회원 목록을 이미 읽었으면 그걸 쓰고, 못 읽었으면 다시 조회한다.
    let rows: ProfileRow[] = profiles ?? []
    if (!profiles) {
      try {
        rows = (
          await listProfiles({
            status: 'approved',
            limit: MEMBER_FETCH_LIMIT,
            offset: 0,
          })
        ).rows
      } catch (retryError) {
        log.error('관리자 알림 대상 재조회 실패', {
          weekKey: key,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
      }
    }

    await alertAdmins(
      rows,
      '지원사업 초안 생성에 실패했습니다',
      `${key} 회차 초안을 만들지 못했습니다. 오늘 오후 자동 발행도 이 회차가 없으면 멈춥니다. ` +
        `원인: ${message.slice(0, 200)}`,
      { weekKey: key }
    )
    return ApiError.internalServerError('초안 생성에 실패했습니다.').toNextResponse()
  }
}
