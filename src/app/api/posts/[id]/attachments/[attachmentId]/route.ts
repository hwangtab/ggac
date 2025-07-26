/**
 * 개별 첨부파일 관리 API
 * GET: 첨부파일 정보 조회
 * PUT: 첨부파일 정보 수정
 * DELETE: 첨부파일 삭제
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
import { cookies } from 'next/headers'

// Service Role 클라이언트는 Storage 작업에만 사용
function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * 첨부파일 정보 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { id: postId, attachmentId } = params

    // 첨부파일 조회
    const { data: attachment, error } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (error || !attachment) {
      return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({ attachment })

  } catch (error) {
    console.error('첨부파일 조회 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 첨부파일 정보 수정
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { id: postId, attachmentId } = params
    const body = await request.json()
    const { alt_text, is_primary, sort_order } = body

    // 첨부파일과 게시글 권한 확인
    const { data: attachment, error: attachmentError } = await supabase
      .from('post_attachments')
      .select(`
        *,
        posts!post_attachments_post_id_fkey(author_id)
      `)
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (attachment.posts.author_id !== session.user.id) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
    }

    // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제
    if (is_primary && attachment.file_type === 'image') {
      await supabase
        .from('post_attachments')
        .update({ is_primary: false })
        .eq('post_id', postId)
        .eq('is_primary', true)
        .neq('id', attachmentId)
    }

    // 첨부파일 정보 업데이트
    const updateData: any = {}
    if (alt_text !== undefined) updateData.alt_text = alt_text
    if (is_primary !== undefined) updateData.is_primary = is_primary && attachment.file_type === 'image'
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updatedAttachment, error: updateError } = await supabase
      .from('post_attachments')
      .update(updateData)
      .eq('id', attachmentId)
      .select()
      .single()

    if (updateError) {
      console.error('첨부파일 수정 오류:', updateError)
      return NextResponse.json({ error: '첨부파일 수정에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      message: '첨부파일이 성공적으로 수정되었습니다.',
      attachment: updatedAttachment
    })

  } catch (error) {
    console.error('첨부파일 수정 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 첨부파일 삭제
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { id: postId, attachmentId } = params

    // 첨부파일과 게시글 권한 확인
    const { data: attachment, error: attachmentError } = await supabase
      .from('post_attachments')
      .select(`
        *,
        posts!post_attachments_post_id_fkey(author_id)
      `)
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 사용자 권한 확인 (작성자 또는 관리자)
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()

    const isAuthor = attachment.posts.author_id === session.user.id
    const isAdmin = profile?.is_admin === true

    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
    }

    // Storage에서 파일 삭제 (가능한 경우에만)
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const urlParts = attachment.file_url.split('/')
      const fileName = urlParts[urlParts.length - 1]
      if (fileName) {
        const fullPath = `posts/${postId}/${fileName}`
        
        const { error: storageError } = await supabaseAdmin.storage
          .from('attachments')
          .remove([fullPath])

        if (storageError) {
          console.warn('Storage 파일 삭제 오류:', storageError)
          // Storage 삭제 실패해도 DB 레코드는 삭제 진행
        }
      }
    } catch (error) {
      console.warn('Storage 삭제 시도 중 오류:', error)
      // Storage 오류여도 DB 삭제는 계속 진행
    }

    // 데이터베이스에서 첨부파일 레코드 삭제
    const { error: deleteError } = await supabase
      .from('post_attachments')
      .delete()
      .eq('id', attachmentId)

    if (deleteError) {
      console.error('첨부파일 DB 삭제 오류:', deleteError)
      return NextResponse.json({ error: '첨부파일 삭제에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      message: '첨부파일이 성공적으로 삭제되었습니다.'
    })

  } catch (error) {
    console.error('첨부파일 삭제 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}