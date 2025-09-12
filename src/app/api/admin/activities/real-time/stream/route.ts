import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // 인증/권한 확인(한 번)
  const supabase = createServerComponentClient({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('is_admin, registration_status, is_active')
    .eq('id', session.user.id)
    .single()
  if (!profile?.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
    return new Response('Forbidden', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const includeActivity = searchParams.get('include_activity') === 'true'
  const intervalMs = Math.min(
    Math.max(parseInt(searchParams.get('interval') || '15000'), 3000),
    60000
  )

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = serviceKey
    ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase

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
      let timer: any
      pushOnce()
      timer = setInterval(pushOnce, intervalMs)

      // 정리
      const close = () => {
        clearInterval(timer)
        controller.close()
      }
      // Close when runtime signals are available
      // 타입 안전하게 접근
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
