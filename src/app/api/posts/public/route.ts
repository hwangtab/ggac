import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createClient } from '@supabase/supabase-js'
import { stripHtmlTags } from '@/utils/textUtils'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseBoardCategory } from '@/constants/categories'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'
import { listPostsKeyset } from '@/db/queries/posts'

const log = createLogger('api/posts/public')
type PublicPostsSortOrder = 'asc' | 'desc'

function parsePublicPostsSortOrder(value: string | null): PublicPostsSortOrder | null {
  if (!value) return 'desc'
  const normalized = value.toLowerCase()
  return normalized === 'asc' || normalized === 'desc' ? normalized : null
}

// 동적 라우트로 강제 — `force-dynamic` 가 ISR `revalidate` 와 충돌하므로 후자 제거.
// 캐시 정책은 응답 헤더(Cache-Control / s-maxage / stale-while-revalidate)에서 직접 관리한다.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

export async function GET(request: NextRequest) {
  // post_attachments(첨부) 통계 조회는 아직 Supabase가 권위다(범위 밖) —
  // posts/member_profiles 조회만 Turso(listPostsKeyset)로 옮긴다.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return ApiError.internalServerError('Supabase not configured').toNextResponse()
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { searchParams } = request.nextUrl
  const categoryParam = searchParams.get('category') || '전체'
  const boardCategory = parseBoardCategory(categoryParam)
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 50 })
  const cursor = searchParams.get('cursor') // `${encodeURIComponent(created_at)}|${id}`
  const sortOrder = parsePublicPostsSortOrder(searchParams.get('sort'))
  const searchRaw = searchParams.get('search') || ''

  try {
    if (!boardCategory) {
      return ApiError.badRequest('유효하지 않은 카테고리입니다.').toNextResponse()
    }
    if (!sortOrder) {
      return ApiError.badRequest('유효하지 않은 정렬 순서입니다.').toNextResponse()
    }

    const parsedCursor = cursor ? parseTimestampUuidCursor(cursor, '게시글 ID') : null
    if (cursor && !parsedCursor) {
      return ApiError.badRequest('유효하지 않은 커서입니다.').toNextResponse()
    }

    let actual: Awaited<ReturnType<typeof listPostsKeyset>>['rows']
    let hasNext: boolean
    try {
      const result = await listPostsKeyset({
        category: boardCategory,
        search: searchRaw || undefined,
        cursor: parsedCursor,
        sortOrder,
        limit,
      })
      actual = result.rows
      hasNext = result.hasNext
    } catch (dbError) {
      log.error('게시글 조회 실패', { message: (dbError as Error)?.message })
      return ApiError.internalServerError('게시글을 불러오는 데 실패했습니다.').toNextResponse()
    }

    const ids = actual.map(p => p.id)

    // Attachments stats (counts)
    const { data: attRows } = await supabase
      .from('post_attachments')
      .select('post_id, file_type')
      .in('post_id', ids)

    const statsMap = new Map<
      string,
      { total: number; image: number; document: number; video: number; audio: number }
    >()
    ;(attRows || []).forEach((r: any) => {
      const key = r.post_id as string
      const type = (r.file_type as string) || 'document'
      const curr = statsMap.get(key) || { total: 0, image: 0, document: 0, video: 0, audio: 0 }
      curr.total += 1
      if (type === 'image') curr.image += 1
      else if (type === 'video') curr.video += 1
      else if (type === 'audio') curr.audio += 1
      else curr.document += 1
      statsMap.set(key, curr)
    })

    const posts = actual.map(row => {
      const clean = stripHtmlTags(row.content || '')
      const preview = clean.length > 150 ? `${clean.substring(0, 150)}...` : clean
      return {
        id: row.id,
        title: row.title,
        content: '',
        category: row.category,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_pinned: row.is_pinned,
        like_count: row.like_count || 0,
        author: { display_name: row.author.display_name },
        content_preview: preview,
        preview_has_images: (statsMap.get(row.id)?.image || 0) > 0,
        preview_image_count: statsMap.get(row.id)?.image || 0,
        comment_count: 0,
        attachments_stats: {
          total_attachments: statsMap.get(row.id)?.total || 0,
          image_count: statsMap.get(row.id)?.image || 0,
          document_count: statsMap.get(row.id)?.document || 0,
          video_count: statsMap.get(row.id)?.video || 0,
          audio_count: statsMap.get(row.id)?.audio || 0,
        },
      }
    })

    let nextCursor: string | null = null
    if (posts.length > 0 && hasNext) {
      const last = posts[posts.length - 1]
      nextCursor = formatTimestampUuidCursor(last.created_at, last.id)
    }

    return ApiSuccess.ok({
      posts,
      pagination: {
        limit,
        has_next: hasNext,
        has_prev: !!parsedCursor,
        next_cursor: nextCursor,
        prev_cursor: null,
      },
      filters: {
        category: boardCategory === '전체' ? null : boardCategory,
        search: searchRaw || null,
        sort_by: 'created_at',
        sort_order: sortOrder,
      },
    }).toNextResponse({
      cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
    })
  } catch (e) {
    log.error('게시글 조회 예외 발생', e)
    return ApiError.internalServerError('요청 처리에 실패했습니다.').toNextResponse()
  }
}
