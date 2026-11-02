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
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { timebankAdminErrorResponse } from '@/lib/server/timebankAdmin'
import { kstMonthKey } from '@/lib/timebank/month'
import { parseMonthParam } from '@/lib/timebank/validate'
import { monthlyOversight } from '@/db/queries/timebankLedger'
import { listSystemSettingHistory } from '@/db/queries/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const [report, settingsHistory] = await Promise.all([
      monthlyOversight(month),
      listSystemSettingHistory('timebank_features', 50),
    ])
    return ApiSuccess.ok({ ...report, settings_history: settingsHistory })
  },
})
