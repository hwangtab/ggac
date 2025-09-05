import { NextRequest, NextResponse } from 'next/server'

// 간단한 보호: 환경변수 DEPLOY_HOOK_SECRET이 설정돼 있으면 헤더로 검증
function validateSecret(req: NextRequest) {
  const required = process.env.DEPLOY_HOOK_SECRET
  if (!required) return true
  const provided = req.headers.get('x-deploy-secret') || req.nextUrl.searchParams.get('secret')
  return provided === required
}

export async function POST(req: NextRequest) {
  if (!validateSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Vercel 통합 Deploy Hook URL (프로젝트에 이미 존재하는 URL)
  const vercelDeployUrl =
    process.env.VERCEL_DEPLOY_HOOK_URL ||
    'https://api.vercel.com/v1/integrations/deploy/prj_gKX9zLcsyxU1udy08ob4AUOeZYmL/LykkHw6E67'

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
