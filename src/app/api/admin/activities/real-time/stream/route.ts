import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // Rate limiting (SSE는 addRateLimitHeaders 생략)
  const rateLimiter = await applyRateLimit({
    ...RATE_LIMIT_CONFIGS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_realtime_stream'),
  })
  const rateLimitResult = await rateLimiter(request)
  if (!rateLimitResult.success && rateLimitResult.response) {
    return rateLimitResult.response
  }

  // 인증/권한 확인
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { db } = auth

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const includeActivity = searchParams.get('include_activity') === 'true'
  const intervalMs = Math.min(
    Math.max(parseInt(searchParams.get('interval') || '15000'), 3000),
    60000
  )

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      async function pushOnce() {
        try {
          const { data: activeUsers } = await db.from('active_users_view').select('*').limit(limit)

          let recentActivity: any[] = []
          if (includeActivity) {
            const { data } = await db.rpc('get_real_time_activity_feed', { p_limit: 30 })
            recentActivity = data || []
          }

          const activeCount = activeUsers?.length || 0
          const sessionsByTime = (activeUsers || []).reduce(
            (acc: Record<string, number>, user: any) => {
              const hour = new Date(user.last_activity).getHours()
              const slot = `${hour}:00-${hour + 1}:00`
              acc[slot] = (acc[slot] || 0) + 1
              return acc
            },
            {} as Record<string, number>
          )

          const payload = {
            activeUsers: activeUsers || [],
            recentActivity,
            statistics: {
              활성사용자수: activeCount,
              총세션수: activeCount,
              시간대별세션수: sessionsByTime,
              평균세션시간:
                (activeUsers || []).reduce(
                  (sum: number, u: any) => sum + (u.minutes_since_activity || 0),
                  0
                ) / Math.max(activeCount, 1),
            },
            metadata: {
              generatedAt: new Date().toISOString(),
              refreshInterval: Math.round(intervalMs / 1000),
              includeActivity,
            },
          }
          controller.enqueue(encoder.encode(`event:update\n`))
          controller.enqueue(encoder.encode(`data:${JSON.stringify(payload)}\n\n`))
        } catch (e) {
          controller.enqueue(encoder.encode(`event:error\n`))
          controller.enqueue(
            encoder.encode(`data:${JSON.stringify({ message: 'stream error' })}\n\n`)
          )
        }
      }

      // 첫 전송 + 주기적 전송
      const MAX_DURATION_MS = 5 * 60 * 1000 // 5분 최대 연결 시간
      const startTime = Date.now()
      let timer: any

      const close = () => {
        clearInterval(timer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)
        try {
          controller.close()
        } catch {
          // 이미 닫혀 있으면 무시
        }
      }

      const wrappedPushOnce = async () => {
        if (Date.now() - startTime >= MAX_DURATION_MS) {
          controller.enqueue(encoder.encode(`event:close\n`))
          controller.enqueue(encoder.encode(`data:${JSON.stringify({ reason: 'timeout' })}\n\n`))
          close()
          return
        }
        await pushOnce()
      }

      pushOnce()
      timer = setInterval(wrappedPushOnce, intervalMs)

      // 최대 연결 시간 보장 타이머
      const maxDurationTimer = setTimeout(() => {
        controller.enqueue(encoder.encode(`event:close\n`))
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ reason: 'timeout' })}\n\n`))
        close()
      }, MAX_DURATION_MS)

      // 클라이언트 연결 해제 시 정리
      const anyReq: any = request as any
      if (anyReq?.signal && typeof anyReq.signal.addEventListener === 'function') {
        anyReq.signal.addEventListener('abort', close)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
