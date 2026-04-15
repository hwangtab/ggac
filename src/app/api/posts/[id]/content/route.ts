import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
export const preferredRegion = 'icn1'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('posts')
    .select('content, content_format')
    .eq('id', id)
    .eq('is_deleted', false)
    .single()

  if (error || !data) {
    if (error) console.error('[API] 게시글 내용 조회 실패:', error)
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
  }
  return NextResponse.json({
    content: (data as any).content || '',
    content_format: (data as any).content_format || 'plain',
  })
}
