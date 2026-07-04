import { createSupabaseServer } from '@/lib/supabase/server'
import { createLogger } from '@/utils/logger'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

const log = createLogger('api/auth/logout')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createSupabaseServer()
    const { error } = await supabase.auth.signOut()

    if (error) {
      log.warn('Logout failed', { message: error.message })
      return ApiError.internalServerError('Logout failed').toNextResponse()
    }

    return ApiSuccess.ok({}).toNextResponse()
  } catch (error) {
    log.error('Unexpected logout error', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
