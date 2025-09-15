import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

async function fetchJSON(url: string) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('x-warmup-token') || ''
    const expected = process.env.WARMUP_TOKEN || ''
    if (!expected || token !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const idsParam = searchParams.get('ids') || ''
    let ids: string[] = []

    if (idsParam) {
      ids = idsParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    } else {
      // Fetch latest posts to warm
      const listUrl = `${base}/api/board/posts?limit=5&refresh=${Date.now()}`
      const list = await fetchJSON(listUrl)
      ids = (list?.posts || []).map((p: any) => p.id).slice(0, 5)
    }

    const tasks: Promise<any>[] = []
    ids.forEach(id => {
      tasks.push(fetch(`${base}/api/board/post/${id}?tt=${Date.now()}`))
      tasks.push(fetch(`${base}/api/posts/${id}/content?tt=${Date.now()}`))
      tasks.push(fetch(`${base}/api/posts/${id}/comments-list?limit=20&tt=${Date.now()}`))
    })

    const started = Date.now()
    await Promise.allSettled(tasks)
    const duration = Date.now() - started

    return NextResponse.json({ success: true, warmed: ids.length, ids, duration_ms: duration })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Warmup failed' }, { status: 500 })
  }
}
