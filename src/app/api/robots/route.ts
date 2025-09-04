import { NextRequest, NextResponse } from 'next/server'

function getBaseUrl(req: NextRequest): string {
  // 우선순위: 환경변수 → 요청 Origin → 로컬 기본값
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (envUrl) return envUrl.replace(/\/$/, '')
  const origin = req.headers.get('origin') || req.nextUrl.origin
  return origin.replace(/\/$/, '')
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request)
  const lines = ['User-agent: *', 'Allow: /', '', `Sitemap: ${baseUrl}/sitemap.xml`]

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
