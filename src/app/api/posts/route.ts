/**
 * 게시글 목록 조회 API
 * 새로운 API 래퍼 시스템 사용
 */

import { NextRequest } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { validateSearchQuery } from '@/utils/validation'
import { createTextPreview } from '@/utils/textUtils'
import {
  apiGet,
  ApiSuccess,
  ApiError,
  requireAuth,
  parsePaginationParams,
  parseSortParams,
  validateApiInput,
} from '@/utils/apiWrapper'

export const runtime = 'nodejs'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('posts'),
})

// 게시글 데이터 타입 정의
interface PostData {
  id: string
  title: string
  content: string
  content_format: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  like_count: number
  comment_count: number
  is_liked?: boolean
  author: {
    display_name: string
    email: string
  }
}

interface PostListResponse {
  posts: PostData[]
  pagination: {
    current_page: number
    total_pages: number
    total_count: number
    per_page: number
    has_next: boolean
    has_prev: boolean
  }
  filters: {
    category: string | null
    search: string | null
    sort_by: string
    sort_order: string
  }
}

// 🚀 성능 최적화: API 라우트 추가 캐싱 설정
export const revalidate = 60 // 60초 동안 결과 캐시

export async function GET(request: NextRequest) {
  // 로그인은 선택사항 (좋아요 상태 확인용)
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id || null // 로그인 상태는 선택사항

  // 비로그인 사용자의 공개 읽기에서 RLS로 인해 빈 목록이 되는 환경을 대비해
  // 서비스 롤 클라이언트를 읽기 전용으로 활용 (서버에서만, 키는 노출되지 않음)
  const adminClient = (() => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!url || !key) return null
      return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    } catch {
      return null
    }
  })()
  // 읽기 쿼리에 사용할 DB 클라이언트 선택
  const db = userId ? supabase : adminClient || supabase

  return apiGet(
    async () => {
      // 🚀 성능 측정 시작
      const startTime = Date.now()
      console.log('📊 [PERFORMANCE] API 요청 시작:', { timestamp: new Date().toISOString() })

      // Rate limiting 적용
      const rateLimitResult = rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      // 읽기(목록 조회)는 공개 허용. 회원 상태 확인으로 차단하지 않음.

      // 쿼리 파라미터 처리
      const { searchParams } = new URL(request.url)
      const category = searchParams.get('category') || '전체'
      const searchRaw = searchParams.get('search') || ''
      const includeLikes = searchParams.get('include_likes') !== 'false'

      // 페이지네이션 파라미터 파싱
      const { page, limit, offset } = parsePaginationParams(searchParams, 20, 50)

      // 정렬 파라미터 파싱
      const allowedSortFields = ['created_at', 'updated_at', 'like_count', 'title']
      const { orderBy: sortBy, orderDirection: sortOrder } = parseSortParams(
        searchParams,
        allowedSortFields,
        'created_at'
      )

      // 검색어 검증
      let search = ''
      if (searchRaw) {
        const searchValidation = validateSearchQuery(searchRaw)
        if (!searchValidation.isValid) {
          throw ApiError.badRequest(
            `유효하지 않은 검색어입니다: ${searchValidation.errors.join(', ')}`
          )
        }
        search = searchValidation.sanitized
      }

      // 허용된 카테고리 검증
      const allowedCategories = ['전체', '공지', '잡담', '홍보', '건의']
      validateApiInput(
        category,
        (cat): cat is string => allowedCategories.includes(cat),
        '유효하지 않은 카테고리입니다.'
      )

      // 🚀 최적화된 쿼리: 기본 게시글 정보 + 작성자 정보 조회
      let query = db
        .from('posts')
        .select(
          `
        id,
        title,
        content,
        content_format,
        category,
        author_id,
        created_at,
        updated_at,
        is_pinned,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
        )
        .or('is_deleted.is.false,is_deleted.is.null')

      // 카테고리 필터 적용
      if (category !== '전체') {
        query = query.eq('category', category)
      }

      // 검색어 적용
      if (search) {
        // 검색 토큰 상한(최대 3개), 각 토큰 길이 제한(>=2)
        const tokens = search
          .split(/\s+/)
          .map(t => t.trim())
          .filter(t => t.length >= 2)
          .slice(0, 3)

        if (tokens.length > 0) {
          const esc = (s: string) => s.replace(/'/g, "''").replace(/\\/g, '\\\\')
          // 모든 토큰이 매칭되도록 AND 구성: (title ilike %t1% OR content ilike %t1%) AND ...
          // Supabase query builder에서 or()는 OR만 지원하므로 키워리스트를 줄여 부하를 완화
          const pattern = tokens
            .map(t => `title.ilike.%${esc(t)}%,content.ilike.%${esc(t)}%`)
            .join(',')
          query = query.or(pattern)
        }
      }

      // 정렬 적용
      const ascending = sortOrder === 'asc'
      if (sortBy === 'created_at') {
        // 고정 게시글을 먼저 표시하고, 그 다음 생성일 순
        query = query.order('is_pinned', { ascending: false, nullsFirst: false })
        query = query.order('created_at', { ascending })
      } else {
        query = query.order(sortBy, { ascending })
      }

      // 페이지네이션 적용
      query = query.range(offset, offset + limit - 1)

      const { data: posts, error: postsError } = await query

      if (postsError) {
        throw new Error(`게시글 조회 실패: ${postsError.message}`)
      }

      // 🚀 성능 최적화: 배치로 모든 부가 정보 조회 (RPC 우선, 실패 시 폴백)
      const postIds = (posts || []).map(post => post.id)

      if (postIds.length === 0) {
        // 게시글이 없는 경우 총 개수만 조회
        let countQuery = db
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .or('is_deleted.is.false,is_deleted.is.null')

        if (category !== '전체') {
          countQuery = countQuery.eq('category', category)
        }

        if (search) {
          const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
          countQuery = countQuery.or(
            `title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`
          )
        }

        const { count } = await countQuery

        const result: PostListResponse = {
          posts: [],
          pagination: {
            current_page: page,
            total_pages: 0,
            total_count: count || 0,
            per_page: limit,
            has_next: false,
            has_prev: false,
          },
          filters: {
            category: category === '전체' ? null : category,
            search: search || null,
            sort_by: sortBy,
            sort_order: sortOrder,
          },
        }

        return ApiSuccess.ok(result, '게시글이 없습니다.')
      }

      // 🚀 병렬 처리: 댓글 수, 첨부파일 통계, 사용자 좋아요, 전체 개수를 동시에 조회
      // RPC: get_posts_meta(post_ids uuid[], user_id uuid) RETURNS JSONB with { comments: {post_id: count}, likes: [post_id...] }
      let rpcComments: Record<string, number> | null = null
      let rpcUserLiked: Set<string> | null = null
      try {
        const { data: meta } = await (db as any).rpc('get_posts_meta', {
          p_post_ids: postIds,
          p_user_id: includeLikes && userId ? userId : null,
        } as any)
        if (meta && typeof meta === 'object') {
          rpcComments = (meta as any).comments || null
          const likedArr = ((meta as any).user_liked || []) as string[]
          rpcUserLiked = new Set(likedArr)
        }
      } catch (e) {
        // RPC가 없거나 실패하면 폴백 쿼리로 처리
      }

      // 댓글 수: RPC 결과가 없으면 폴백 쿼리 (post_id만 가져와 서버에서 집계)
      const commentCountPromise = rpcComments
        ? Promise.resolve({ data: null as any })
        : ((db as any).from('comments').select('post_id', { head: false }) as any)
            .in('post_id', postIds)
            .eq('is_deleted', false)

      const userLikesPromise = rpcUserLiked
        ? Promise.resolve({ data: null as any })
        : includeLikes && userId
          ? supabase
              .from('post_likes')
              .select('post_id')
              .in('post_id', postIds)
              .eq('user_id', userId)
          : Promise.resolve({ data: [] as { post_id: string }[] })

      // 첨부파일 통계: 한 번의 조회로 post_id, file_type만 가져와 서버에서 집계
      const attachmentsStatsPromise = db
        .from('post_attachments')
        .select('post_id, file_type')
        .in('post_id', postIds)

      let countQuery = db
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .or('is_deleted.is.false,is_deleted.is.null')

      if (category !== '전체') {
        countQuery = countQuery.eq('category', category)
      }

      if (search) {
        const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
        countQuery = countQuery.or(
          `title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`
        )
      }

      const [
        { data: commentCounts },
        { data: userLikes },
        { data: attachmentRows },
        { count, error: countError },
      ] = await Promise.all([
        commentCountPromise,
        userLikesPromise,
        attachmentsStatsPromise,
        countQuery,
      ])

      if (countError) {
        throw new Error(`게시글 수 조회 실패: ${countError.message}`)
      }

      // 게시글별 댓글 수 계산
      const commentCountMap = new Map<string, number>()
      if (rpcComments) {
        Object.entries(rpcComments).forEach(([pid, cnt]) => {
          commentCountMap.set(pid, Number(cnt) || 0)
        })
      } else {
        if (Array.isArray(commentCounts) && commentCounts.length > 0) {
          const first: any = commentCounts[0]
          if ('count' in first) {
            // 만약 count 필드가 있다면 그대로 사용
            commentCounts.forEach((item: any) => {
              const postId = item.post_id
              const count = Number(item.count) || 0
              commentCountMap.set(postId, count)
            })
          } else {
            // post_id만 있는 경우 서버에서 집계
            commentCounts.forEach((item: any) => {
              const postId = item.post_id
              commentCountMap.set(postId, (commentCountMap.get(postId) || 0) + 1)
            })
          }
        }
      }

      // 게시글별 첨부파일 통계 계산
      const attachmentStatsMap = new Map<
        string,
        {
          total_attachments: number
          image_count: number
          document_count: number
          video_count: number
          audio_count: number
        }
      >()
      if (attachmentRows && Array.isArray(attachmentRows)) {
        for (const row of attachmentRows as any[]) {
          const pid = row.post_id as string
          const type = (row.file_type as string) || 'document'
          if (!attachmentStatsMap.has(pid)) {
            attachmentStatsMap.set(pid, {
              total_attachments: 0,
              image_count: 0,
              document_count: 0,
              video_count: 0,
              audio_count: 0,
            })
          }
          const s = attachmentStatsMap.get(pid)!
          s.total_attachments += 1
          if (type === 'image') s.image_count += 1
          else if (type === 'video') s.video_count += 1
          else if (type === 'audio') s.audio_count += 1
          else s.document_count += 1
        }
      }

      // ✅ 좋아요 수는 posts.like_count 컬럼을 그대로 사용 (추가 쿼리 제거)

      // 사용자 좋아요 맵 생성
      const userLikesMap = new Map<string, boolean>()
      if (rpcUserLiked) {
        rpcUserLiked.forEach(pid => userLikesMap.set(pid, true))
      } else {
        userLikes?.forEach(like => {
          userLikesMap.set(like.post_id, true)
        })
      }

      // 🚀 최적화된 결과 조합
      const postsWithExtra = (posts || []).map(raw => {
        const preview = createTextPreview(raw.content || '', 150)
        const post: any = {
          id: raw.id,
          title: raw.title,
          // 서버에서 미리보기 텍스트 생성 (본문은 응답에서 제외)
          content_preview: preview.text,
          preview_has_images: preview.hasImages,
          preview_image_count: preview.imageCount,
          content_format: raw.content_format,
          category: raw.category,
          author_id: raw.author_id,
          created_at: raw.created_at,
          updated_at: raw.updated_at,
          is_pinned: raw.is_pinned,
          like_count: (raw as any).like_count || 0,
          comment_count: commentCountMap.get(raw.id) || 0,
          is_liked: includeLikes ? userLikesMap.get(raw.id) || false : undefined,
          attachments_stats: attachmentStatsMap.get(raw.id) || {
            total_attachments: 0,
            image_count: 0,
            document_count: 0,
            video_count: 0,
            audio_count: 0,
          },
          author: Array.isArray((raw as any).author) ? (raw as any).author[0] : (raw as any).author,
        }
        return post
      }) as any[]

      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit)

      const result: PostListResponse = {
        posts: postsWithExtra,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
        filters: {
          category: category === '전체' ? null : category,
          search: search || null,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      }

      // 🚀 성능 측정 완료
      const endTime = Date.now()
      const duration = endTime - startTime
      console.log('📊 [PERFORMANCE] API 응답 완료:', {
        duration: `${duration}ms`,
        postsCount: postsWithExtra.length,
        totalCount,
        dbQueries: includeLikes && userId ? 3 : 2, // posts + userLikes(optional) + count (comments in column)
        cacheHit: false, // 첫 로드는 항상 cache miss
        timestamp: new Date().toISOString(),
      })

      return ApiSuccess.ok(result, `게시글 목록을 성공적으로 조회했습니다. (${duration}ms)`)
    },
    '/api/posts',
    {
      userId,
      // 사용자별(is_liked 포함) 응답은 퍼블릭 캐시 금지
      cacheable: !userId,
      maxAge: 60, // 비로그인 트래픽만 1분 캐시
    }
  )
}
