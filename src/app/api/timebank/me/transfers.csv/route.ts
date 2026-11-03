/**
 * 내 내역 CSV 내려받기(GET `?month=YYYY-MM`) (스펙 §8 내보내기, §15 M).
 *
 * - `requireTimebankReader`: 꺼져 있어도 내 기록은 받아 간다(§7.2).
 * - **세션 회원의 내역만.** 쿼리스트링은 `month`만 읽는다(없거나 틀리면 이번 달 KST).
 * - 열·이스케이프·BOM은 `buildTimebankCsv`(`csvCell`, 분은 양수 + 방향 칸, KST).
 * - 사용자 키 레이트리밋 10/시간.
 * - 개인 내역이다 — 어떤 공유 캐시에도 남기지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/utils/apiWrapper'
import { requireTimebankReader, timebankRateLimit } from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { listTransfersFor, type TransferRow } from '@/db/queries/timebankLedger'
import { parseMonthParam } from '@/lib/timebank/validate'
import { kstMonthKey } from '@/lib/timebank/month'
import { buildTimebankCsv, timebankCsvDisposition } from '@/lib/timebank/format'
import { createLogger } from '@/utils/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('timebankCsv')

/** 한 달 내역의 상한. 대기 상한(10건)과 월 상한이 있어 정상 사용으로는 닿지 않는다. */
const PAGE_SIZE = 500
const MAX_PAGES = 10

export async function GET(request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const rl = await applyRouteRateLimit(request, timebankRateLimit('csv', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const month =
    parseMonthParam(request.nextUrl.searchParams.get('month')) ?? kstMonthKey(new Date())

  try {
    const rows: TransferRow[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await listTransfersFor({
        memberId: user.id,
        monthKey: month,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      rows.push(...result.rows)
      if (!result.has_next) break
    }

    return new NextResponse(buildTimebankCsv(rows, user.id), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': timebankCsvDisposition(month),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    log.error('타임 내역 CSV 생성 실패', { error: (error as Error)?.message })
    return ApiError.internalServerError('내역을 내려받지 못했습니다.').toNextResponse()
  }
}
