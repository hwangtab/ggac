import { NextRequest, NextResponse } from 'next/server'

// 보호: DEPLOY_HOOK_SECRET 헤더 검증 (프로덕션에서는 필수)
function validateSecret(req: NextRequest): boolean {
  const required = process.env.DEPLOY_HOOK_SECRET
  if (!required) {
    // 프로덕션에서는 시크릿 미설정 시 차단
    if (process.env.NODE_ENV === 'production') return false
    return true
  }
  const provided = req.headers.get('x-deploy-secret') || req.nextUrl.searchParams.get('secret')
  return provided === required
}

export async function POST(req: NextRequest) {
  if (!validateSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const vercelDeployUrl = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!vercelDeployUrl) {
    return NextResponse.json({ error: 'VERCEL_DEPLOY_HOOK_URL is not configured' }, { status: 500 })
  }

  try {
    const res = await fetch(vercelDeployUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: 'Deploy trigger failed', status: res.status, body: text },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Deploy triggered' })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
