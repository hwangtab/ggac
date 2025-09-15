import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin configuration missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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

    const supabase = getSupabaseAdmin()

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
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to fetch profiles' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: profiles })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || 'Unexpected error' },
      { status: 500 }
    )
  }
}
export const runtime = 'edge'
export const preferredRegion = 'icn1'
