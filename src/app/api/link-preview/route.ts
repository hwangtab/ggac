import { NextRequest, NextResponse } from 'next/server'
import { fetchLinkPreview } from '@/utils/linkPreview'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  console.log('Link preview API called with URL:', url)

  if (!url) {
    console.log('No URL provided')
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 })
  }

  try {
    // 프로토콜 및 형식 1차 검증 (세부 SSRF 검사는 유틸 내부에서 수행)
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https are allowed' }, { status: 400 })
    }
    console.log('URL validation passed:', url)
  } catch (error) {
    console.log('Invalid URL format:', url, error)
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  try {
    const preview = await fetchLinkPreview(url)

    if (!preview) {
      console.log('Failed to fetch preview for:', url)
      return NextResponse.json({ error: 'Failed to fetch link preview' }, { status: 404 })
    }

    console.log('Successfully fetched preview for:', url)
    return NextResponse.json(preview)
  } catch (error) {
    console.error('Link preview API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
