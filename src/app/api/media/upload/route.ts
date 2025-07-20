/**
 * 범용 미디어 업로드 API 엔드포인트
 * MediaManager 컴포넌트에서 사용하는 범용 파일 업로드 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { MediaFile } from '@/types'

// 기본 설정
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png', 
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm'
]

// 버킷별 설정
const BUCKET_CONFIGS = {
  profiles: {
    max_file_size: 2 * 1024 * 1024, // 2MB
    allowed_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  attachments: {
    max_file_size: 50 * 1024 * 1024, // 50MB
    allowed_types: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'video/mp4', 'video/webm', 'audio/mpeg'
    ]
  }
}

// 파일 타입 검증
function validateFile(file: File, bucket: string = 'attachments'): { valid: boolean; error?: string } {
  const config = BUCKET_CONFIGS[bucket as keyof typeof BUCKET_CONFIGS] || {
    max_file_size: DEFAULT_MAX_FILE_SIZE,
    allowed_types: DEFAULT_ALLOWED_TYPES
  }

  if (!config.allowed_types.includes(file.type)) {
    return {
      valid: false,
      error: `지원하지 않는 파일 형식입니다. 허용된 형식: ${config.allowed_types.join(', ')}`
    }
  }

  if (file.size > config.max_file_size) {
    const maxSizeMB = (config.max_file_size / 1024 / 1024).toFixed(1)
    return {
      valid: false,
      error: `파일 크기가 너무 큽니다. 최대 ${maxSizeMB}MB까지 가능합니다.`
    }
  }

  return { valid: true }
}

// 안전한 파일명 생성
function generateSafeFileName(originalName: string, userId: string): string {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = originalName.split('.').pop()?.toLowerCase() || 'bin'
  const baseName = originalName.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
  
  return `${userId}_${timestamp}_${randomId}_${baseName}.${extension}`
}

// Storage 경로 생성
function generateStoragePath(bucket: string, userId: string, fileName: string): string {
  const safeFileName = generateSafeFileName(fileName, userId)
  
  switch (bucket) {
    case 'profiles':
      return `profiles/${userId}/${safeFileName}`
    case 'attachments':
      return `attachments/${userId}/${safeFileName}`
    default:
      return `general/${userId}/${safeFileName}`
  }
}

// 파일 메타데이터 추출
async function extractFileMetadata(file: File): Promise<Record<string, any>> {
  const metadata: Record<string, any> = {
    original_filename: file.name,
    file_size: file.size,
    content_type: file.type,
    uploaded_at: new Date().toISOString()
  }

  // 이미지 파일인 경우 추가 메타데이터 추출
  if (file.type.startsWith('image/')) {
    try {
      const dimensions = await getImageDimensions(file)
      metadata.width = dimensions.width
      metadata.height = dimensions.height
    } catch (error) {
      console.error('Failed to extract image dimensions:', error)
    }
  }

  return metadata
}

// 이미지 크기 추출
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
      }
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * POST: 파일 업로드
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { success: false, error: '로그인이 필요합니다.' },
        { status: 401 }
      )
    }

    // 사용자 상태 확인 (승인된 멤버만)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { success: false, error: '승인된 활성 멤버만 파일을 업로드할 수 있습니다.' },
        { status: 403 }
      )
    }

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File
    const bucket = (formData.get('bucket') as string) || 'attachments'
    const metadataStr = formData.get('metadata') as string

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 제공되지 않았습니다.' },
        { status: 400 }
      )
    }

    // 파일 유효성 검사
    const validation = validateFile(file, bucket)
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      )
    }

    // 사용자 제공 메타데이터 파싱
    let userMetadata: Record<string, any> = {}
    if (metadataStr) {
      try {
        userMetadata = JSON.parse(metadataStr)
      } catch (error) {
        console.error('Invalid metadata:', error)
      }
    }

    // Storage 경로 생성
    const storagePath = generateStoragePath(bucket, session.user.id, file.name)

    // Supabase Storage에 파일 업로드
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { success: false, error: '파일 업로드에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(storagePath)

    if (!publicUrlData?.publicUrl) {
      return NextResponse.json(
        { success: false, error: '공개 URL 생성에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 파일 메타데이터 추출
    const fileMetadata = await extractFileMetadata(file)
    const finalMetadata = { ...fileMetadata, ...userMetadata }

    // MediaFile 객체 생성
    const mediaFile: MediaFile = {
      id: uploadData.id || `upload-${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      type: file.type,
      path: storagePath,
      public_url: publicUrlData.publicUrl,
      uploaded_at: new Date().toISOString(),
      metadata: finalMetadata
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      file: mediaFile,
      // 호환성을 위한 추가 필드들
      id: mediaFile.id,
      name: mediaFile.name,
      path: mediaFile.path,
      public_url: mediaFile.public_url,
      metadata: finalMetadata
    }, { status: 200 })

  } catch (error) {
    console.error('Media upload error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * GET: 업로드된 파일 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { success: false, error: '로그인이 필요합니다.' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const bucket = searchParams.get('bucket') || 'attachments'
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Storage에서 사용자 파일 목록 조회
    const { data: files, error: listError } = await supabase.storage
      .from(bucket)
      .list(`${session.user.id}/`, {
        limit,
        offset,
        sortBy: { column: 'created_at', order: 'desc' }
      })

    if (listError) {
      console.error('Storage list error:', listError)
      return NextResponse.json(
        { success: false, error: '파일 목록 조회에 실패했습니다.' },
        { status: 500 }
      )
    }

    // MediaFile 형태로 변환
    const mediaFiles: MediaFile[] = (files || []).map((file, index) => {
      const filePath = `${session.user.id}/${file.name}`
      const { data: publicUrlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath)

      return {
        id: `${bucket}-${file.name}-${index}`,
        name: file.name,
        size: file.metadata?.size || 0,
        type: file.metadata?.mimetype || 'application/octet-stream',
        path: filePath,
        public_url: publicUrlData?.publicUrl || '',
        uploaded_at: file.created_at || new Date().toISOString(),
        metadata: file.metadata || {}
      }
    })

    return NextResponse.json({
      success: true,
      files: mediaFiles,
      total: mediaFiles.length,
      has_more: mediaFiles.length === limit
    }, { status: 200 })

  } catch (error) {
    console.error('Media list error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}