import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/auth/logout')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createSupabaseServer()
    const { error } = await supabase.auth.signOut()

    if (error) {
      log.warn('Logout failed', { message: error.message })
      return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error('Unexpected logout error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
