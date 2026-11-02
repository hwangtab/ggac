/**
 * 관리자 타임뱅크 잔액표(GET `/api/admin/timebank/accounts`, 스펙 §7.3, 계획 Task 9).
 *
 * - 잔액은 `balancesByAccount`(GROUP BY 한 번). 조합 계좌는 행이 아니라 발행잔액으로.
 * - 플래그: 잔액 > `soft_max_minutes` → `over_soft_max`, ≤ `low_balance_flag_minutes`
 *   → `low_balance`(`buildAccountsReport`).
 * - 7일 넘은 pending(kind 무관)과 두 번째 승인을 기다리는 조정.
 *
 * 기능 스위치와 무관하게 연다(§7.2 — 꺼져도 관리자는 정산·조정을 한다).
 */
import { ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { timebankAdminErrorResponse } from '@/lib/server/timebankAdmin'
import { COOP_ACCOUNT, STALE_PENDING_DAYS } from '@/constants/timebank'
import { buildAccountsReport } from '@/lib/timebank/adminRules'
import { getTimebankSettings } from '@/lib/timebank/settings'
import {
  balancesByAccount,
  listPendingAdjustments,
  listStalePending,
} from '@/db/queries/timebankLedger'
import { getProfilesByIds } from '@/db/queries/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/timebank/accounts',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_accounts'),
  },
  auth: 'admin',
  errorResponse: timebankAdminErrorResponse('accounts', '잔액표를 불러오지 못했습니다.'),
  handler: async () => {
    const [settings, balances, stale, pendingAdjustments] = await Promise.all([
      getTimebankSettings(),
      balancesByAccount(),
      listStalePending(STALE_PENDING_DAYS),
      listPendingAdjustments(),
    ])
    const profiles = await getProfilesByIds(
      balances.map(b => b.account).filter(account => account !== COOP_ACCOUNT)
    )
    // 표시명만 넘긴다 — 프로필 행의 다른 칸(연락처·계좌)은 응답 근처에 두지 않는다.
    const names = new Map(
      [...profiles].map(([id, p]) => [id, { display_name: p.display_name ?? null }])
    )
    const report = buildAccountsReport({ balances, names, settings })
    return ApiSuccess.ok({
      ...report,
      thresholds: {
        soft_max_minutes: settings.soft_max_minutes,
        low_balance_flag_minutes: settings.low_balance_flag_minutes,
        stale_pending_days: STALE_PENDING_DAYS,
      },
      stale_pending: stale,
      pending_adjustments: pendingAdjustments,
    })
  },
})
