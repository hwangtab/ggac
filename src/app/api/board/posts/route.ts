import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { fetchBoardPosts } from '@/lib/server/board'
import { createLogger } from '@/utils/logger'

// `dynamic = 'force-dynamic'` 가 설정되어 있어 페이지 단위 ISR(`revalidate`)은
// 의미가 없으므로 제거. 캐시 정책은 응답 헤더(`cacheControl`)로 직접 제어한다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

const log = createLogger('api/board/posts')

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') || '전체'
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50)
  const refresh = searchParams.get('refresh')

  try {
    const result = await fetchBoardPosts({ category, page, pageSize: limit })
    return ApiSuccess.ok({
      posts: result.posts,
      hasNext: result.hasNext,
      hasPrev: result.hasPrev,
      currentPage: result.currentPage,
    }).toNextResponse({
      cacheControl: refresh
        ? 'no-cache, no-store, must-revalidate'
        : 'public, s-maxage=60, stale-while-revalidate=300',
    })
  } catch (error) {
    log.warn('fetchBoardPosts 실패', error)
    return ApiError.internalServerError('Failed to fetch board posts').toNextResponse()
  }
}
