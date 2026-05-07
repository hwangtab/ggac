import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createSupabaseServer } from '@/lib/supabase/server'
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
    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    // 사용자 프로필 확인 (승인된 멤버인지 체크)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return createErrorResponse(
        { success: false, error: '프로필 정보를 가져올 수 없습니다.' },
        500
      )
    }

    if (!profile || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '승인된 멤버만 활동 내역을 조회할 수 있습니다.' },
        { status: 403 }
      )
    }

    // 쿼리 파라미터 검증
    const { searchParams } = new URL(request.url)
    const queryResult = ActivityQuerySchema.safeParse({
      filter: searchParams.get('filter'),
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
    })

    if (!queryResult.success) {
      return NextResponse.json(
        { error: '잘못된 쿼리 파라미터입니다.', details: queryResult.error.issues },
        { status: 400 }
      )
    }

    const { filter, page, limit } = queryResult.data
    const offset = (page - 1) * limit
    const userId = user.id

    // 활동 데이터 수집
    const activities: Activity[] = []
    let totalCount = 0

    // 게시글 활동 조회 (filter가 'all' 또는 'posts'인 경우)
    if (filter === 'all' || filter === 'posts') {
      const { data: posts, error: postsError } = await supabase
        .from('posts')
        .select('id, title, category, created_at, updated_at')
        .eq('author_id', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })

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
      const { data: comments, error: commentsError } = await supabase
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

    return NextResponse.json(response)
  } catch (error) {
    console.error('Activity API error:', error)
    return NextResponse.json(
      { error: '활동 내역을 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
