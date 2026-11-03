/**
 * 마감된 장터 경매 닫기 (크론 전용, 10분마다).
 *
 * 경매는 상세·목록·입찰 요청이 들어올 때 그 자리에서 닫힌다
 * (`closeAuctionAndNotify`). 이 크론은 **아무도 들여다보지 않는 경매**를 줍는
 * 안전망이다 — 없으면 낙찰자·판매자가 낙찰 알림을 영영 받지 못한다.
 *
 * 인증은 다른 내부 크론과 같다: `CRON_SECRET` Bearer, 없으면 닫는다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { sweepDueAuctions } from '@/lib/server/marketAuctionClose'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/market/close-auctions')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 한 번에 닫는 최대 건수. 남으면 다음 실행이 줍는다. */
const BATCH = 50

function isAuthorized(request: NextRequest): boolean {
  const expected = [process.env.CRON_SECRET].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  if (expected.length === 0) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  return expected.some(
    t => provided.length === t.length && timingSafeEqual(Buffer.from(provided), Buffer.from(t))
  )
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) return ApiError.unauthorized('권한이 없습니다.').toNextResponse()
  const closed = await sweepDueAuctions(BATCH)
  if (closed > 0) log.info('마감 경매 닫기', { closed })
  return ApiSuccess.ok({ closed }).toNextResponse()
}

export const GET = handle
export const POST = handle
