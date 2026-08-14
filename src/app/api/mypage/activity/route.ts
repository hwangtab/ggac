import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 활동 타입 정의
interface Activity {
  id: string
  type: 'post_created' | 'post_updated' | 'comment_created' | 'profile_updated'
  title?: string
  entityId: string
  createdAt: string
  metadata?: {
    category?: string
    postTitle?: string
    postId?: string // 댓글의 경우 게시글 ID
    profileSection?: string
  }
}

// 페이지네이션 정보
interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalCount: number
  hasNext: boolean
}

// API 응답 타입
interface ActivityResponse {
  activities: Activity[]
  pagination: PaginationInfo
}

// 쿼리 파라미터 검증 스키마
const ActivityQuerySchema = z.object({
  filter: z.enum(['all', 'posts', 'comments', 'profile']).default('all'),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
})

// GET: 현재 사용자의 활동 내역 조회
export async function GET(request: NextRequest) {
  try {
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    // 쿼리 파라미터 검증
    const { searchParams } = new URL(request.url)
    const queryResult = ActivityQuerySchema.safeParse({
      filter: searchParams.get('filter'),
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
    })

    if (!queryResult.success) {
      return ApiError.badRequest('잘못된 쿼리 파라미터입니다.').toNextResponse()
    }

    const { filter, page, limit } = queryResult.data
    const offset = (page - 1) * limit
    const userId = user.id

    // 활동 데이터 수집
    const activities: Activity[] = []
    let totalCount = 0

    // 소스별 최대 로드 행 수 — 기존에는 무제한 전량 로드라 활동 많은 사용자에서
    // 응답 크기·시간이 무한 증가했다(전수감사 API Medium 12). 게시글 수정 활동의
    // 시간 역전(updated_at) 때문에 정확한 페이지 컷오프가 어려워, 정확성을
    // 보존하면서 폭주만 막는 캡으로 둔다(초과분은 오래된 활동부터 목록에서 제외).
    const SOURCE_ROW_CAP = 500

    // 게시글/댓글 활동은 상호 독립이므로 병렬 조회한다(기존 순차).
    const [postsResult, commentsResult] = await Promise.all([
      filter === 'all' || filter === 'posts'
        ? supabase
            .from('posts')
            .select('id, title, category, created_at, updated_at')
            .eq('author_id', userId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(SOURCE_ROW_CAP)
        : Promise.resolve({ data: null, error: null }),
      filter === 'all' || filter === 'comments'
        ? supabase
            .from('comments')
            .select(
              `
              id,
              created_at,
              posts:post_id (
                id,
                title,
                category
              )
            `
            )
            .eq('author_id', userId)
            .order('created_at', { ascending: false })
            .limit(SOURCE_ROW_CAP)
        : Promise.resolve({ data: null, error: null }),
    ])

    // 게시글 활동 조회 (filter가 'all' 또는 'posts'인 경우)
    if (filter === 'all' || filter === 'posts') {
      const { data: posts, error: postsError } = postsResult

      if (postsError) {
        console.error('Posts fetch error:', postsError)
      } else if (posts) {
        // 게시글 생성 활동
        posts.forEach(post => {
          activities.push({
            id: `post_created_${post.id}`,
            type: 'post_created',
            title: post.title,
            entityId: post.id,
            createdAt: post.created_at,
            metadata: {
              category: post.category,
            },
          })

          // 게시글 수정 활동 (생성일과 수정일이 다른 경우)
          if (post.updated_at && post.updated_at !== post.created_at) {
            activities.push({
              id: `post_updated_${post.id}`,
              type: 'post_updated',
              title: post.title,
              entityId: post.id,
              createdAt: post.updated_at,
              metadata: {
                category: post.category,
              },
            })
          }
        })
      }
    }

    // 댓글 활동 조회 (filter가 'all' 또는 'comments'인 경우)
    if (filter === 'all' || filter === 'comments') {
      const { data: comments, error: commentsError } = commentsResult

      if (commentsError) {
        console.error('Comments fetch error:', commentsError)
      } else if (comments) {
        comments.forEach(comment => {
          const post = comment.posts as any
          activities.push({
            id: `comment_created_${comment.id}`,
            type: 'comment_created',
            entityId: comment.id,
            createdAt: comment.created_at,
            metadata: {
              postTitle: post?.title || '알 수 없는 게시글',
              postId: post?.id, // 게시글 ID 추가
              category: post?.category,
            },
          })
        })
      }
    }

    // 프로필 활동은 현재 추적하지 않음 (향후 구현)
    // if (filter === 'all' || filter === 'profile') {
    //   // 프로필 수정 활동 추가 예정
    // }

    // 시간순 정렬
    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // 페이지네이션 적용
    totalCount = activities.length
    const paginatedActivities = activities.slice(offset, offset + limit)

    // 페이지네이션 정보 계산
    const totalPages = Math.ceil(totalCount / limit)
    const pagination: PaginationInfo = {
      currentPage: page,
      totalPages,
      totalCount,
      hasNext: page < totalPages,
    }

    const response: ActivityResponse = {
      activities: paginatedActivities,
      pagination,
    }

    return ApiSuccess.ok(response).toNextResponse()
  } catch (error) {
    console.error('Activity API error:', error)
    return ApiError.internalServerError(
      '활동 내역을 조회하는 중 오류가 발생했습니다.'
    ).toNextResponse()
  }
}
