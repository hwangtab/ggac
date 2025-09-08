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
    limit: number
    has_next: boolean
    has_prev: boolean
    next_cursor: string | null
    prev_cursor: string | null
    total_count?: number // 선택적, 성능상 이유로 제외 가능
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

      // 키셋 페이지네이션 파라미터 파싱
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)
      const cursor = searchParams.get('cursor') // created_at:id 형태
      const direction = searchParams.get('direction') || 'next' // next | prev

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
        .not('is_deleted', 'is', true)

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

      // 키셋 페이지네이션 적용
      if (cursor && sortBy === 'created_at') {
        try {
          // ISO 타임스탬프에 콜론이 포함되므로 파이프(|)로 구분
          const [encodedCreatedAt, cursorId] = cursor.split('|')
          const cursorCreatedAt = encodedCreatedAt ? decodeURIComponent(encodedCreatedAt) : null

          if (cursorCreatedAt && cursorId && !isNaN(Date.parse(cursorCreatedAt))) {
            if (direction === 'prev') {
              // 이전 페이지: created_at > cursor 또는 (created_at = cursor AND id > cursor_id)
              query = query.or(
                `created_at.gt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.gt.${cursorId})`
              )
              query = query.order('created_at', { ascending: true })
              query = query.order('id', { ascending: true })
            } else {
              // 다음 페이지: created_at < cursor 또는 (created_at = cursor AND id < cursor_id)
              query = query.or(
                `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`
              )
              query = query.order('created_at', { ascending: false })
              query = query.order('id', { ascending: false })
            }
          }
        } catch (error) {
          console.warn('커서 파싱 오류, 첫 페이지로 폴백:', error)
          // 커서 파싱 실패 시 첫 페이지로 폴백
        }
      } else {
        // 첫 페이지 또는 비시간순 정렬
        const ascending = sortOrder === 'asc'
        if (sortBy === 'created_at') {
          // 고정 게시글을 먼저 표시하고, 그 다음 생성일 순
          query = query.order('is_pinned', { ascending: false, nullsFirst: false })
          query = query.order('created_at', { ascending })
          query = query.order('id', { ascending })
        } else {
          query = query.order(sortBy, { ascending })
          query = query.order('id', { ascending })
        }
      }

      // limit + 1로 다음 페이지 존재 여부 확인
      query = query.limit(limit + 1)

      const { data: posts, error: postsError } = await query

      if (postsError) {
        throw new Error(`게시글 조회 실패: ${postsError.message}`)
      }

      // 키셋 페이지네이션: 다음 페이지 존재 여부 확인 및 실제 데이터 분리
      let actualPosts = posts || []
      const hasNext = actualPosts.length > limit

      if (hasNext) {
        actualPosts = actualPosts.slice(0, limit) // 초과분 제거
      }

      const postIds = actualPosts.map(post => post.id)

      if (postIds.length === 0) {
        const result: PostListResponse = {
          posts: [],
          pagination: {
            limit,
            has_next: false,
            has_prev: !!cursor, // 커서가 있으면 이전 페이지 존재
            next_cursor: null,
            prev_cursor: null,
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

      const [{ data: commentCounts }, { data: userLikes }, { data: attachmentRows }] =
        await Promise.all([commentCountPromise, userLikesPromise, attachmentsStatsPromise])

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

      // 🚀 최적화된 결과 조합 (실제 반환할 posts 사용)
      const postsWithExtra = actualPosts.map(raw => {
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

      // 커서 생성: 첫 번째와 마지막 게시글 기준
      let nextCursor: string | null = null
      let prevCursor: string | null = null

      if (postsWithExtra.length > 0) {
        const lastPost = postsWithExtra[postsWithExtra.length - 1]
        const firstPost = postsWithExtra[0]

        if (hasNext) {
          // ISO 타임스탬프에 콜론이 포함되므로 파이프(|)를 구분자로 사용
          nextCursor = `${encodeURIComponent(lastPost.created_at)}|${lastPost.id}`
        }

        if (cursor) {
          // 이미 커서를 통해 접근한 경우, 첫 번째 게시글로 이전 커서 생성
          prevCursor = `${encodeURIComponent(firstPost.created_at)}|${firstPost.id}`
        }
      }

      const result: PostListResponse = {
        posts: postsWithExtra,
        pagination: {
          limit,
          has_next: hasNext,
          has_prev: !!cursor,
          next_cursor: nextCursor,
          prev_cursor: prevCursor,
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
      console.log('📊 [PERFORMANCE] API 응답 완료 (키셋 페이지네이션):', {
        duration: `${duration}ms`,
        postsCount: postsWithExtra.length,
        hasNext,
        cursor: cursor || 'first_page',
        dbQueries: includeLikes && userId ? 3 : 2, // posts + userLikes(optional) (no count query)
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
