export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createSuccessResponse, createErrorResponse } from '@/utils/apiResponse'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    const supabase = await createSupabaseServer()
    const { id } = resolvedParams

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse('인증이 필요합니다.', 401)
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Admin posts [ID] - Profile fetch error:', profileError)
      return createErrorResponse('프로필 정보를 조회할 수 없습니다.', 500)
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return createErrorResponse('관리자 권한이 필요합니다.', 403)
    }

    // Get action from request body
    const { action } = await request.json()

    if (!action || !['delete', 'restore', 'pin', 'unpin'].includes(action)) {
      return createErrorResponse('잘못된 작업입니다.', 400)
    }

    // Get the post to check if it exists
    const { data: post } = await supabase
      .from('posts')
      .select('id, category, is_deleted, is_pinned')
      .eq('id', id)
      .single()

    if (!post) {
      return createErrorResponse('게시글을 찾을 수 없습니다.', 404)
    }

    // Prepare update data based on action
    let updateData: any = {}

    switch (action) {
      case 'delete':
        if (post.is_deleted) {
          return createErrorResponse('이미 삭제된 게시글입니다.', 400)
        }
        updateData = { is_deleted: true }
        break

      case 'restore':
        if (!post.is_deleted) {
          return createErrorResponse('삭제되지 않은 게시글입니다.', 400)
        }
        updateData = { is_deleted: false }
        break

      case 'pin':
        if (post.category !== '공지') {
          return createErrorResponse('공지사항만 고정할 수 있습니다.', 400)
        }
        if (post.is_pinned) {
          return createErrorResponse('이미 고정된 게시글입니다.', 400)
        }
        updateData = {
          is_pinned: true,
          pinned_at: new Date().toISOString(),
        }
        break

      case 'unpin':
        if (!post.is_pinned) {
          return createErrorResponse('고정되지 않은 게시글입니다.', 400)
        }
        updateData = {
          is_pinned: false,
          pinned_at: null,
        }
        break
    }

    // Update the post
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Admin posts [ID] - Post update error:', updateError)
      console.error('Update data:', updateData)
      console.error('Post ID:', id)
      return createErrorResponse('게시글 업데이트에 실패했습니다.', 500)
    }

    const actionMessage =
      action === 'delete'
        ? '삭제'
        : action === 'restore'
          ? '복원'
          : action === 'pin'
            ? '고정'
            : '고정 해제'
    return createSuccessResponse({
      post: updatedPost,
      message: `게시글 ${actionMessage}가 완료되었습니다.`,
    })
  } catch (error) {
    console.error('Admin posts [ID] - API error:', error)

    return createErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
