/**
 * 게시글 첨부파일 관리 API
 * GET: 첨부파일 목록 조회
 * POST: 첨부파일 업로드
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { PostAttachment, PostAttachmentStats } from '@/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

// Service Role 클라이언트는 Storage 작업에만 사용
let supabaseAdmin: ReturnType<typeof createClient> | null = null
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// 허용된 파일 타입과 크기
const ALLOWED_FILE_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav']
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_TOTAL_SIZE = 100 * 1024 * 1024 // 100MB per post
const MAX_FILES_PER_POST = 10

/**
 * 첨부파일 목록 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const postId = params.id

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 첨부파일 목록 조회
    const { data: attachments, error: attachmentsError } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('sort_order', { ascending: true })

    if (attachmentsError) {
      console.error('첨부파일 조회 오류:', attachmentsError)
      return NextResponse.json({ error: '첨부파일을 조회할 수 없습니다.' }, { status: 500 })
    }

    // 첨부파일 통계 계산 (클라이언트 사이드에서)
    let stats: PostAttachmentStats = {
      total_attachments: attachments?.length || 0,
      total_size: attachments?.reduce((sum, att) => sum + att.file_size, 0) || 0,
      image_count: attachments?.filter(att => att.file_type === 'image').length || 0,
      document_count: attachments?.filter(att => att.file_type === 'document').length || 0,
      video_count: attachments?.filter(att => att.file_type === 'video').length || 0,
      audio_count: attachments?.filter(att => att.file_type === 'audio').length || 0
    }

    return NextResponse.json({
      attachments: attachments || [],
      stats
    })

  } catch (error) {
    console.error('첨부파일 조회 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 첨부파일 업로드
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const postId = params.id

    // 게시글 존재 및 권한 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (post.author_id !== session.user.id) {
      return NextResponse.json({ error: '게시글 작성자만 첨부파일을 업로드할 수 있습니다.' }, { status: 403 })
    }

    // 멀티파트 폼 데이터 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File
    const altText = formData.get('alt_text') as string || ''
    const isPrimary = formData.get('is_primary') === 'true'

    if (!file || file.size === 0) {
      return NextResponse.json({ error: '파일이 선택되지 않았습니다.' }, { status: 400 })
    }

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 업로드 가능합니다.` 
      }, { status: 400 })
    }

    // 파일 타입 검증
    const fileType = getFileType(file.type)
    if (!fileType || !ALLOWED_FILE_TYPES[fileType].includes(file.type)) {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다.' }, { status: 400 })
    }

    // 현재 게시글의 첨부파일 제한 확인 (클라이언트에서 직접)
    const { data: existingAttachments, error: existingError } = await supabase
      .from('post_attachments')
      .select('file_size')
      .eq('post_id', postId)

    if (existingError) {
      console.error('기존 첨부파일 조회 오류:', existingError)
      return NextResponse.json({ error: '첨부파일 제한 확인에 실패했습니다.' }, { status: 500 })
    }

    const currentCount = existingAttachments?.length || 0
    const currentTotalSize = existingAttachments?.reduce((sum, att) => sum + att.file_size, 0) || 0

    // 제한 확인
    if (currentCount >= MAX_FILES_PER_POST) {
      return NextResponse.json({ 
        error: `첨부파일 개수 제한을 초과했습니다. (최대 ${MAX_FILES_PER_POST}개)` 
      }, { status: 400 })
    }

    if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
      return NextResponse.json({ 
        error: `첨부파일 총 크기 제한을 초과했습니다. (최대 ${MAX_TOTAL_SIZE / 1024 / 1024}MB)` 
      }, { status: 400 })
    }

    // Storage 클라이언트 확인
    if (!supabaseAdmin) {
      return NextResponse.json({ 
        error: 'Storage 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.' 
      }, { status: 503 })
    }

    // 파일을 Supabase Storage에 업로드
    const fileBuffer = await file.arrayBuffer()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}-${file.name}`
    const filePath = `posts/${postId}/${fileName}`

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false
      })

    if (uploadError) {
      console.error('파일 업로드 오류:', uploadError)
      // Storage bucket이 없는 경우 특별한 메시지
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('not found')) {
        return NextResponse.json({ 
          error: 'Storage가 설정되지 않았습니다. 관리자가 Supabase Storage bucket을 생성해야 합니다.' 
        }, { status: 503 })
      }
      return NextResponse.json({ error: '파일 업로드에 실패했습니다.' }, { status: 500 })
    }

    // 업로드된 파일의 공개 URL 생성
    const { data: urlData } = supabaseAdmin.storage
      .from('attachments')
      .getPublicUrl(filePath)

    // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제
    if (isPrimary && fileType === 'image') {
      await supabase
        .from('post_attachments')
        .update({ is_primary: false })
        .eq('post_id', postId)
        .eq('is_primary', true)
    }

    // 첨부파일 메타데이터를 데이터베이스에 저장
    const { data: attachment, error: dbError } = await supabase
      .from('post_attachments')
      .insert({
        post_id: postId,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        file_size: file.size,
        mime_type: file.type,
        alt_text: altText || null,
        is_primary: isPrimary && fileType === 'image'
      })
      .select()
      .single()

    if (dbError) {
      console.error('첨부파일 메타데이터 저장 오류:', dbError)
      
      // 업로드된 파일 삭제 (롤백)
      if (supabaseAdmin) {
        await supabaseAdmin.storage
          .from('attachments')
          .remove([filePath])
      }

      return NextResponse.json({ error: '첨부파일 정보 저장에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      message: '첨부파일이 성공적으로 업로드되었습니다.',
      attachment
    })

  } catch (error) {
    console.error('첨부파일 업로드 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 파일 MIME 타입에서 파일 종류 추출
 */
function getFileType(mimeType: string): 'image' | 'document' | 'video' | 'audio' | null {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('word')) {
    return 'document'
  }
  return null
}