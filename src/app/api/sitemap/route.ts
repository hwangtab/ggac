import { NextRequest, NextResponse } from 'next/server'
import { getArtistSlugs, getProjectSlugs } from '@/lib/data'

function getBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (envUrl) return envUrl.replace(/\/$/, '')
  const origin = req.headers.get('origin') || req.nextUrl.origin
  return origin.replace(/\/$/, '')
}

function urlNode(loc: string, lastmod?: string, changefreq: string = 'weekly', priority = 0.7) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request)
  const now = new Date().toISOString()

  // 공개 정적 경로들 (보호 페이지 제외)
  const staticPaths = ['/', '/about', '/archive', '/artists', '/connect', '/privacy', '/terms']

  const nodes: string[] = []

  // 정적 경로 추가
  for (const p of staticPaths) {
    nodes.push(urlNode(`${baseUrl}${p}`, now, 'weekly', p === '/' ? 1.0 : 0.7))
  }

  // 동적 경로: 아티스트/프로젝트
  try {
    const [artistSlugs, projectSlugs] = await Promise.all([
      getArtistSlugs().catch(() => []),
      getProjectSlugs().catch(() => []),
    ])

    for (const slug of artistSlugs) {
      nodes.push(urlNode(`${baseUrl}/artists/${slug}`, now, 'weekly', 0.8))
    }
    for (const slug of projectSlugs) {
      nodes.push(urlNode(`${baseUrl}/archive/${slug}`, now, 'weekly', 0.8))
    }
  } catch (e) {
    // 실패 시 정적 경로만 포함
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    nodes.join('\n'),
    '</urlset>',
  ].join('\n')

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
