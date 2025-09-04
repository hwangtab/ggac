/**
 * 게시글 첨부파일 관리 API
 * GET: 첨부파일 목록 조회
 * POST: 첨부파일 업로드
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { PostAttachment, PostAttachmentStats } from '@/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { validateUUID, isValidTempId } from '@/utils/validation'
import { generateUniqueFileName, sanitizeFileNameWithDetails } from '@/utils/fileNameSanitizer'
import { validateFile, FILE_VALIDATION_PROFILES, formatValidationErrors } from '@/utils/fileUploadValidation'

// Service Role 클라이언트는 Storage 작업에만 사용
function getSupabaseAdmin() {
  console.log('[SUPABASE ADMIN] 환경 변수 확인');
  console.log('[SUPABASE ADMIN] SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('[SUPABASE ADMIN] SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[SUPABASE ADMIN] SUPABASE_SERVICE_ROLE_KEY가 설정되지 않음');
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('[SUPABASE ADMIN] NEXT_PUBLIC_SUPABASE_URL이 설정되지 않음');
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }
  
  console.log('[SUPABASE ADMIN] 클라이언트 생성 중...');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * 첨부파일 목록 조회
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await context.params;
  try {
    const postId = resolvedParams.id;
    
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID');
    if (!uuidValidation.isValid) {
      console.log('[API] ATTACHMENTS GET UUID 검증 실패:', uuidValidation.errors);
      return NextResponse.json({ 
        error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' 
      }, { status: 400 });
    }
    
    const validPostId = uuidValidation.sanitized;
    
    // 공개 읽기 허용: 인증 없이도 첨부파일 목록을 조회할 수 있게 함
    // (쓰기/업로드는 계속 보호됨)
    const supabase = createRouteHandlerClient({ cookies })

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id')
      .eq('id', validPostId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 첨부파일 목록 조회
    const { data: attachments, error: attachmentsError } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', validPostId)
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
  context: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await context.params;
  try {
    console.log('[UPLOAD API] 요청 시작');
    const postId = resolvedParams.id;
    
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID');
    if (!uuidValidation.isValid) {
      console.error('[UPLOAD API] UUID 검증 실패:', uuidValidation.errors);
      return NextResponse.json({ 
        error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' 
      }, { status: 400 });
    }
    
    console.log('[UPLOAD API] UUID 검증 성공:', postId);
    
    const supabase = createRouteHandlerClient({ cookies })
    console.log('[UPLOAD API] Supabase 클라이언트 생성 완료');
    
    const { data: { session } } = await supabase.auth.getSession()
    console.log('[UPLOAD API] 세션 조회 완료:', !!session?.user);

    if (!session?.user) {
      console.error('[UPLOAD API] 인증 실패 - 세션 없음');
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const validPostId = uuidValidation.sanitized
    const isTempId = isValidTempId(validPostId);
    console.log('[UPLOAD API] 인증 성공, 사용자 ID:', session.user.id, '임시 ID:', isTempId);

    // 임시 ID가 아닌 경우에만 게시글 존재 및 권한 확인
    let post = null;
    if (!isTempId) {
      console.log('[UPLOAD API] 게시글 조회 시작:', validPostId);
      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('id, author_id')
        .eq('id', validPostId)
        .single()

      if (postError || !postData) {
        console.error('[UPLOAD API] 게시글 조회 실패:', postError);
        return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
      }

      console.log('[UPLOAD API] 게시글 조회 성공, 작성자:', postData.author_id);

      if (postData.author_id !== session.user.id) {
        console.error('[UPLOAD API] 권한 없음 - 작성자가 아님');
        return NextResponse.json({ error: '게시글 작성자만 첨부파일을 업로드할 수 있습니다.' }, { status: 403 })
      }
      
      post = postData;
    } else {
      console.log('[UPLOAD API] 임시 ID로 업로드 - 게시글 존재 확인 생략');
    }

    // 멀티파트 폼 데이터 파싱
    console.log('[UPLOAD API] 폼 데이터 파싱 시작');
    const formData = await request.formData()
    const file = formData.get('file') as File
    const altText = formData.get('alt_text') as string || ''
    const isPrimary = formData.get('is_primary') === 'true'

    console.log('[UPLOAD API] 파일 정보:', {
      name: file?.name,
      type: file?.type,
      size: file?.size,
      altText,
      isPrimary
    });

    if (!file || file.size === 0) {
      console.error('[UPLOAD API] 파일이 없음');
      return NextResponse.json({ error: '파일이 선택되지 않았습니다.' }, { status: 400 })
    }

    // 공통 파일 검증 로직 사용
    const validation = validateFile(file, FILE_VALIDATION_PROFILES.POST_ATTACHMENTS, [], session.user.id)
    
    if (!validation.isValid) {
      console.error('[UPLOAD API] 파일 검증 실패:', validation.errors)
      return NextResponse.json({ 
        error: formatValidationErrors(validation.errors)
      }, { status: 400 })
    }

    // 파일 타입 추출 (검증에서 이미 확인됨)
    const fileType = validation.fileType!

    // 임시 ID가 아닌 경우에만 첨부파일 제한 확인
    if (!isTempId) {
      const { data: existingAttachments, error: existingError } = await supabase
        .from('post_attachments')
        .select('file_size')
        .eq('post_id', validPostId)

      if (existingError) {
        console.error('기존 첨부파일 조회 오류:', existingError)
        return NextResponse.json({ error: '첨부파일 제한 확인에 실패했습니다.' }, { status: 500 })
      }

      const currentCount = existingAttachments?.length || 0
      const currentTotalSize = existingAttachments?.reduce((sum, att) => sum + att.file_size, 0) || 0

      // 검증 설정에서 제한값 가져오기
      const config = FILE_VALIDATION_PROFILES.POST_ATTACHMENTS
      
      // 제한 확인
      if (currentCount >= (config.maxFiles || 10)) {
        return NextResponse.json({ 
          error: `첨부파일 개수 제한을 초과했습니다. (최대 ${config.maxFiles}개)` 
        }, { status: 400 })
      }

      if (config.maxTotalSize && currentTotalSize + file.size > config.maxTotalSize) {
        return NextResponse.json({ 
          error: `첨부파일 총 크기 제한을 초과했습니다. (최대 ${config.maxTotalSize / 1024 / 1024}MB)` 
        }, { status: 400 })
      }
    } else {
      console.log('[UPLOAD API] 임시 ID - 첨부파일 제한 확인 생략');
    }

    // Storage 클라이언트 생성 및 파일 업로드
    console.log('[UPLOAD API] Storage 클라이언트 생성 시작');
    let supabaseAdmin;
    try {
      supabaseAdmin = getSupabaseAdmin();
      console.log('[UPLOAD API] Storage 클라이언트 생성 성공');
    } catch (error) {
      console.error('[UPLOAD API] Supabase Admin 클라이언트 생성 오류:', error);
      return NextResponse.json({ 
        error: 'Storage 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.' 
      }, { status: 503 })
    }

    // 파일명 정제 및 고유 파일명 생성 (공통 검증에서 이미 생성됨)
    console.log('[UPLOAD API] 파일명 정제 시작');
    const uniqueFileName = validation.uniqueFileName || generateUniqueFileName(file.name);
    console.log('[UPLOAD API] 고유 파일명:', uniqueFileName);
    
    // 파일을 Supabase Storage에 업로드
    console.log('[UPLOAD API] 파일 버퍼 변환 시작');
    const fileBuffer = await file.arrayBuffer()
    console.log('[UPLOAD API] 파일 버퍼 변환 완료, 크기:', fileBuffer.byteLength);
    
    // 임시 파일과 영구 파일의 경로 구분
    const filePath = isTempId 
      ? `temp/${validPostId}/${uniqueFileName}` 
      : `posts/${validPostId}/${uniqueFileName}`;
    console.log('[UPLOAD API] Storage 업로드 시작:', filePath, '(임시:', isTempId, ')');

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false
      })

    if (uploadError) {
      console.error('[UPLOAD API] Storage 업로드 실패:', {
        error: uploadError,
        message: uploadError.message
      });
      
      // Storage bucket이 없는 경우 특별한 메시지
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('not found')) {
        return NextResponse.json({ 
          error: 'Storage가 설정되지 않았습니다. 관리자가 Supabase Storage bucket을 생성해야 합니다.' 
        }, { status: 503 })
      }
      return NextResponse.json({ 
        error: `파일 업로드에 실패했습니다: ${uploadError.message}` 
      }, { status: 500 })
    }

    console.log('[UPLOAD API] Storage 업로드 성공:', uploadData);

    // 업로드된 파일의 공개 URL 생성
    console.log('[UPLOAD API] 공개 URL 생성 시작');
    const { data: urlData } = supabaseAdmin.storage
      .from('attachments')
      .getPublicUrl(filePath)
    console.log('[UPLOAD API] 공개 URL 생성 완료:', urlData.publicUrl);

    // 임시 파일이 아닌 경우에만 데이터베이스 저장
    if (!isTempId) {
      // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제
      if (isPrimary && fileType === 'image') {
        console.log('[UPLOAD API] 기존 대표 이미지 해제 시작');
        const { error: primaryError } = await supabase
          .from('post_attachments')
          .update({ is_primary: false })
          .eq('post_id', validPostId)
          .eq('is_primary', true)
        
        if (primaryError) {
          console.warn('[UPLOAD API] 기존 대표 이미지 해제 실패:', primaryError);
        } else {
          console.log('[UPLOAD API] 기존 대표 이미지 해제 완료');
        }
      }

      // 첨부파일 메타데이터를 데이터베이스에 저장
      console.log('[UPLOAD API] 메타데이터 저장 시작');
      const attachmentData = {
        post_id: validPostId,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        file_size: file.size,
        mime_type: file.type,
        alt_text: altText || null,
        is_primary: isPrimary && fileType === 'image'
      };
      console.log('[UPLOAD API] 저장할 데이터:', attachmentData);

      const { data: attachment, error: dbError } = await supabase
        .from('post_attachments')
        .insert(attachmentData)
        .select()
        .single()

      if (dbError) {
        console.error('[UPLOAD API] 메타데이터 저장 실패:', {
          error: dbError,
          message: dbError.message,
          code: dbError.code,
          details: dbError.details
        });
        
        // 업로드된 파일 삭제 (롤백)
        console.log('[UPLOAD API] 파일 롤백 시작');
        try {
          await supabaseAdmin.storage
            .from('attachments')
            .remove([filePath])
          console.log('[UPLOAD API] 파일 롤백 완료');
        } catch (rollbackError) {
          console.error('[UPLOAD API] 파일 롤백 실패:', rollbackError);
        }

        return NextResponse.json({ 
          error: `첨부파일 정보 저장에 실패했습니다: ${dbError.message}` 
        }, { status: 500 })
      }

      console.log('[UPLOAD API] 메타데이터 저장 성공:', attachment);

      return NextResponse.json({
        message: '첨부파일이 성공적으로 업로드되었습니다.',
        attachment
      })
    } else {
      // 임시 파일의 경우 임시 첨부파일로 데이터베이스에 저장
      console.log('[UPLOAD API] 임시 파일 메타데이터 저장 시작');
      
      // 24시간 후 만료 설정
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      const tempAttachmentData = {
        post_id: validPostId, // 임시 ID
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        file_size: file.size,
        mime_type: file.type,
        alt_text: altText || null,
        is_primary: false, // 임시 파일은 대표 이미지가 될 수 없음
        is_temporary: true,
        temp_session: session.user.id, // 사용자 ID를 세션으로 사용
        expires_at: expiresAt.toISOString()
      };
      
      console.log('[UPLOAD API] 임시 첨부파일 저장 데이터:', tempAttachmentData);

      const { data: tempAttachment, error: tempDbError } = await supabase
        .from('post_attachments')
        .insert(tempAttachmentData)
        .select()
        .single()

      if (tempDbError) {
        console.error('[UPLOAD API] 임시 첨부파일 저장 실패:', tempDbError);
        
        // 실패 시 업로드된 파일 삭제
        try {
          await supabaseAdmin.storage
            .from('attachments')
            .remove([filePath])
          console.log('[UPLOAD API] 임시 파일 롤백 완료');
        } catch (rollbackError) {
          console.error('[UPLOAD API] 임시 파일 롤백 실패:', rollbackError);
        }

        return NextResponse.json({ 
          error: `임시 이미지 저장에 실패했습니다: ${tempDbError.message}` 
        }, { status: 500 })
      }

      console.log('[UPLOAD API] 임시 파일 업로드 완료:', tempAttachment);
      return NextResponse.json({
        message: '임시 이미지가 성공적으로 업로드되었습니다.',
        url: urlData.publicUrl,
        attachment: tempAttachment,
        tempId: validPostId,
        expiresAt: expiresAt.toISOString()
      })
    }

  } catch (error) {
    console.error('[UPLOAD API] 예외 발생:', {
      error,
      message: error instanceof Error ? error.message : '알 수 없는 오류',
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json({ 
      error: `서버 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}` 
    }, { status: 500 })
  }
}
