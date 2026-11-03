/**
 * 이사회·감사 타임뱅크 보고(GET `/api/board-room/timebank/oversight?month=YYYY-MM`,
 * 스펙 §7.4·§9.2, 계획 Task 9).
 *
 * 스펙은 `/api/timebank/oversight` + `canAccessBoardRoom`이지만, 특권 트리 게이트
 * 가드(`assert-runtime-risks.mjs`)의 보호를 받도록 이사회 트리에 둔다. 게이트
 * `'board-member'`(`requireBoardMember`)가 곧 `canAccessBoardRoom`이다(이사·감사·관리자).
 *
 * 월별 발행·회수·발행잔액, 조합 업무 회원별 합계, 조정 전 건, 마이너스 탈퇴 정산
 * (`monthlyOversight`)과 타임뱅크 설정 변경 이력(의결 근거 포함). `month`가 없으면
 * 이번 달(KST), 형식이 틀리면 400. 읽기 전용이고 기능 스위치와 무관하다.
 *
 * 파일럿 지표(스펙 §12)도 함께 싣는다(`pilot`): 조합원 공개 집계와 같은 칸이되
 * `boardPilotStats`다 — 사람 수 3명 미만 구간만 null이고, 조합원판(`publicStats`)이
 * 가리는 이번 달 교환 건수·분과 3건 미만 건수는 감독용으로 그대로 싣는다. 요청 글을 쓴 조합원 비율,
 * 고른 달과 그 앞 다섯 달의 발행잔액 추이.
 *
 * 조정 건의 "누가·승인자"는 id라 표시명을 `actor_names`로 따로 싣는다(표시명만 —
 * 프로필의 다른 칸은 응답 근처에 두지 않는다).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { timebankAdminErrorResponse } from '@/lib/server/timebankAdmin'
import { kstMonthKey, shiftMonthKey } from '@/lib/timebank/month'
import { parseMonthParam } from '@/lib/timebank/validate'
import { boardPilotStats } from '@/lib/timebank/format'
import { getTimebankSettings } from '@/lib/timebank/settings'
import { monthlyOversight, outstandingTrend, participationStats } from '@/db/queries/timebankLedger'
import { requestAuthorShare } from '@/db/queries/timebankBoard'
import { getProfilesByIds } from '@/db/queries/profiles'
import { listSystemSettingHistory } from '@/db/queries/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 발행잔액 추이에 싣는 달 수(고른 달 포함). */
const TREND_MONTHS = 6

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/board-room/timebank/oversight',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('board_timebank_oversight'),
  },
  auth: 'board-member',
  errorResponse: timebankAdminErrorResponse('oversight', '타임뱅크 보고를 불러오지 못했습니다.'),
  handler: async ({ request }) => {
    const raw = request.nextUrl.searchParams.get('month')
    const month = raw === null || raw === '' ? kstMonthKey(new Date()) : parseMonthParam(raw)
    if (!month) throw ApiError.badRequest('월은 YYYY-MM 형식으로 보내 주세요.')

    const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) =>
      shiftMonthKey(month, i - (TREND_MONTHS - 1))
    )
    const settings = await getTimebankSettings()
    const [report, settingsHistory, stats, requestShare, trend] = await Promise.all([
      monthlyOversight(month),
      listSystemSettingHistory('timebank_features', 50),
      participationStats(month, settings),
      requestAuthorShare(month),
      outstandingTrend(trendMonths),
    ])
    const actorIds = [
      ...new Set(
        report.adjustments
          .flatMap(a => [a.created_by, a.approved_by])
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ]
    const actors = await getProfilesByIds(actorIds)
    const actorNames = Object.fromEntries(
      [...actors].map(([id, p]) => [id, p.display_name ?? null])
    )
    return ApiSuccess.ok({
      ...report,
      actor_names: actorNames,
      settings_history: settingsHistory,
      pilot: {
        ...boardPilotStats(stats),
        request_authors: requestShare.request_authors,
        request_author_participants: requestShare.participants,
        request_author_ratio: requestShare.ratio,
        outstanding_trend: trend,
      },
      thresholds: {
        soft_max_minutes: settings.soft_max_minutes,
        low_balance_flag_minutes: settings.low_balance_flag_minutes,
      },
    })
  },
})
