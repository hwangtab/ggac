import { RATE_LIMITS, defineStreamRoute } from '@/lib/server/streamRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { parseIntegerParam } from '@/utils/queryParams'
import { listActiveUsers } from '@/db/queries/sessions'
import { getRealTimeActivityFeed } from '@/db/queries/activities'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * 진짜 상한은 이 값이다 — Vercel이 함수를 여기서 자른다. 명시하지 않으면
 * 플랫폼 기본값(300초)이 조용히 적용되는데, 그 값이 아래 `MAX_DURATION_MS`와
 * 같으면 스트림은 **매번** 자기 종료를 내지 못하고 플랫폼에 잘려 런타임
 * 오류로 기록된다. 정상 종료가 오류 로그로 남으면 진짜 오류가 그 안에 묻힌다.
 */
export const maxDuration = 300

export const GET = defineStreamRoute({
  method: 'GET',
  name: 'api/admin/activities/real-time/stream',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_realtime_stream'),
  },
  auth: 'admin',
  handler: async ({ request }) => {
    const { searchParams } = new URL(request.url)
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 100 })
    const includeActivity = searchParams.get('include_activity') === 'true'
    const intervalMs = parseIntegerParam(searchParams.get('interval'), 15000, {
      min: 3000,
      max: 60000,
    })

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        async function pushOnce() {
          try {
            // 단계 4: active_users_view/get_real_time_activity_feed RPC를
            // Turso 쿼리 계층(listActiveUsers/getRealTimeActivityFeed)으로
            // 대체했다.
            const activeUsers = await listActiveUsers(limit)

            let recentActivity: any[] = []
            if (includeActivity) {
              recentActivity = await getRealTimeActivityFeed({ limit: 30 })
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
        // 위 `maxDuration`(300초)보다 **의미 있게 짧게** 둔다. 이 타이머가 먼저
        // 울어야 아래 `event:close`를 내보내고 컨트롤러를 스스로 닫을 수 있다 —
        // 클라이언트는 그 신호를 보고 재연결한다. 같은 값으로 두면 경합에서
        // 플랫폼이 이기고 연결이 그냥 끊긴다.
        const MAX_DURATION_MS = 4.5 * 60 * 1000 // 4분 30초 — 플랫폼 상한보다 30초 앞선다
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
  },
})
