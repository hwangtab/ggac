import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { fetchBoardPosts } from '@/lib/server/board'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseBoardCategory } from '@/constants/categories'

// `dynamic = 'force-dynamic'` 가 설정되어 있어 페이지 단위 ISR(`revalidate`)은
// 의미가 없으므로 제거. 캐시 정책은 응답 헤더(`cacheControl`)로 직접 제어한다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

const log = createLogger('api/board/posts')

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const categoryParam = searchParams.get('category') || '전체'
  const boardCategory = parseBoardCategory(categoryParam)
  const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 50 })
  const refresh = searchParams.get('refresh')

  try {
    if (!boardCategory) {
      return ApiError.badRequest('유효하지 않은 카테고리입니다.').toNextResponse()
    }

    const result = await fetchBoardPosts({ category: boardCategory, page, pageSize: limit })

    // degraded === true는 쿼리가 실패한 게 아니라 TURSO_DATABASE_URL이 없어
    // fetchBoardPosts가 DB 조회 자체를 건너뛴 경우다(src/lib/server/board.ts 참고).
    // 이 라우트는 s-maxage=60으로 응답을 CDN에 캐시하므로, 그냥 200 빈 목록을
    // 내려버리면 빈 게시판이 최소 60초, stale-while-revalidate까지 합치면 최대
    // 300초 더 굳어서 서빙된다. ApiError.toNextResponse()는 항상
    // private, no-store를 강제하므로 이 응답은 캐시되지 않는다.
    if (result.degraded) {
      log.error('TURSO_DATABASE_URL 미설정으로 게시판 조회 불가 — 200 대신 503으로 응답합니다')
      return ApiError.serviceUnavailable(
        '게시판 서비스를 일시적으로 사용할 수 없습니다.'
      ).toNextResponse()
    }

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
