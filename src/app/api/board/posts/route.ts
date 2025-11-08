import { NextRequest } from 'next/server'
import { createErrorResponse, createJsonResponse } from '@/utils/apiResponse'
import { fetchBoardPosts } from '@/lib/server/board'

export const revalidate = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') || '전체'
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50)
  const refresh = searchParams.get('refresh')

  try {
    const result = await fetchBoardPosts({ category, page, pageSize: limit })
    return createJsonResponse(
      {
        posts: result.posts,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev,
        currentPage: result.currentPage,
      },
      200,
      {
        'Cache-Control': refresh
          ? 'no-cache, no-store, must-revalidate'
          : 'public, s-maxage=60, stale-while-revalidate=300',
      }
    )
  } catch (error: any) {
    console.warn('[API board/posts] fetchBoardPosts error', error?.message)
    return createErrorResponse('Failed to fetch board posts', 500)
  }
}
