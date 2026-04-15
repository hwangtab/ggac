import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase configuration missing')
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const idsParam = searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }
    if (ids.length > 100) {
      return NextResponse.json({ success: false, error: 'Too many ids (max 100)' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Try public view first, then fallback to member_profiles
    let profiles: Array<{ id: string; display_name: string }> = []
    let error: any = null

    const tryView = await supabase.from('public_profiles').select('id, display_name').in('id', ids)

    if (tryView.error) {
      // Fallback to member_profiles if view doesn't exist
      const tryTable = await supabase
        .from('member_profiles')
        .select('id, display_name')
        .in('id', ids)
      error = tryTable.error
      profiles = (tryTable.data as any) || []
    } else {
      profiles = (tryView.data as any) || []
    }

    if (error) {
      console.error('[API] 프로필 조회 실패:', error)
      return NextResponse.json(
        { success: false, error: '프로필 정보를 불러오는 데 실패했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: profiles })
  } catch (e: any) {
    console.error('[API] 프로필 조회 예외 발생:', e)
    return NextResponse.json(
      { success: false, error: '요청 처리에 실패했습니다.' },
      { status: 500 }
    )
  }
}
export const runtime = 'edge'
export const preferredRegion = 'icn1'
