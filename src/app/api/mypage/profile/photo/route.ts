/**
 * 프로필 사진 관리 API 엔드포인트
 * PUT: 프로필 사진 업로드/변경
 * DELETE: 프로필 사진 삭제
 * GET: 프로필 사진 메타데이터 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { 
  ProfilePhotoUploadResponse, 
  ProfilePhotoMetadata,
  ImageCropSettings 
} from '@/types'

// 허용된 파일 타입
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// 최대 파일 크기 (2MB)
const MAX_FILE_SIZE = 2 * 1024 * 1024

// 파일 타입 검증
function validateFileType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type)
}

// 파일 크기 검증
function validateFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE
}

// 이미지 메타데이터 추출 (서버 사이드)
async function extractImageMetadata(file: File): Promise<Partial<ProfilePhotoMetadata>> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        resolve({
          width: img.width,
          height: img.height,
          content_type: file.type,
          file_size: file.size,
          original_filename: file.name
        })
      }
      img.onerror = () => {
        resolve({
          content_type: file.type,
          file_size: file.size,
          original_filename: file.name
        })
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

// Storage 경로 생성
function generateStoragePath(userId: string, fileExtension: string): string {
  const timestamp = Date.now()
  return `profiles/${userId}/profile_${timestamp}.${fileExtension}`
}

// 파일 확장자 추출
function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop()?.toLowerCase() || 'jpg' : 'jpg'
}

/**
 * PUT: 프로필 사진 업로드/변경
 */
export async function PUT(request: NextRequest) {
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
        { success: false, error: '승인된 활성 멤버만 프로필 사진을 업로드할 수 있습니다.' },
        { status: 403 }
      )
    }

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File
    const cropSettingsStr = formData.get('crop_settings') as string
    const metadataStr = formData.get('metadata') as string

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 제공되지 않았습니다.' },
        { status: 400 }
      )
    }

    // 파일 유효성 검사
    if (!validateFileType(file)) {
      return NextResponse.json(
        { success: false, error: '지원하지 않는 파일 형식입니다. JPEG, PNG, WebP, GIF만 가능합니다.' },
        { status: 400 }
      )
    }

    if (!validateFileSize(file)) {
      return NextResponse.json(
        { success: false, error: '파일 크기가 너무 큽니다. 최대 2MB까지 가능합니다.' },
        { status: 400 }
      )
    }

    // 크롭 설정 파싱
    let cropSettings: ImageCropSettings | undefined
    if (cropSettingsStr) {
      try {
        cropSettings = JSON.parse(cropSettingsStr)
      } catch (error) {
        console.error('Invalid crop settings:', error)
      }
    }

    // 메타데이터 파싱
    let providedMetadata: Partial<ProfilePhotoMetadata> = {}
    if (metadataStr) {
      try {
        providedMetadata = JSON.parse(metadataStr)
      } catch (error) {
        console.error('Invalid metadata:', error)
      }
    }

    // 기존 프로필 사진 조회 (삭제를 위해)
    const { data: currentProfile } = await supabase
      .from('member_profiles')
      .select('profile_photo_url')
      .eq('id', session.user.id)
      .single()

    // Storage 경로 생성
    const fileExtension = getFileExtension(file.name)
    const storagePath = generateStoragePath(session.user.id, fileExtension)

    // Supabase Storage에 파일 업로드
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('profiles')
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
      .from('profiles')
      .getPublicUrl(storagePath)

    if (!publicUrlData?.publicUrl) {
      return NextResponse.json(
        { success: false, error: '공개 URL 생성에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 이미지 메타데이터 추출 (클라이언트에서 제공된 경우 사용)
    const imageMetadata = await extractImageMetadata(file)

    // 최종 메타데이터 생성
    const finalMetadata: ProfilePhotoMetadata = {
      ...imageMetadata,
      ...providedMetadata,
      uploaded_at: new Date().toISOString(),
      processed: true,
      crop_info: cropSettings
    }

    // 데이터베이스 업데이트
    const { error: updateError } = await supabase
      .from('member_profiles')
      .update({
        profile_photo_url: publicUrlData.publicUrl,
        profile_photo_metadata: finalMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.user.id)

    if (updateError) {
      console.error('Database update error:', updateError)
      
      // 실패 시 업로드된 파일 삭제
      await supabase.storage
        .from('profiles')
        .remove([storagePath])

      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 기존 프로필 사진 삭제 (Storage에서)
    if (currentProfile?.profile_photo_url) {
      try {
        // URL에서 파일 경로 추출
        const url = new URL(currentProfile.profile_photo_url)
        const pathParts = url.pathname.split('/')
        const fileName = pathParts[pathParts.length - 1]
        const oldPath = `profiles/${session.user.id}/${fileName}`

        await supabase.storage
          .from('profiles')
          .remove([oldPath])
      } catch (error) {
        console.error('Failed to delete old profile photo:', error)
        // 이 오류는 치명적이지 않으므로 계속 진행
      }
    }

    // 성공 응답
    const response: ProfilePhotoUploadResponse = {
      success: true,
      photo_url: publicUrlData.publicUrl,
      metadata: finalMetadata,
      public_url: publicUrlData.publicUrl
    }

    return NextResponse.json(response, { status: 200 })

  } catch (error) {
    console.error('Profile photo upload error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * DELETE: 프로필 사진 삭제
 */
export async function DELETE(request: NextRequest) {
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

    // 현재 프로필 사진 정보 조회
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('profile_photo_url')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    if (!profile.profile_photo_url) {
      return NextResponse.json(
        { success: false, error: '삭제할 프로필 사진이 없습니다.' },
        { status: 400 }
      )
    }

    // Storage에서 파일 삭제
    try {
      const url = new URL(profile.profile_photo_url)
      const pathParts = url.pathname.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const filePath = `profiles/${session.user.id}/${fileName}`

      const { error: deleteError } = await supabase.storage
        .from('profiles')
        .remove([filePath])

      if (deleteError) {
        console.error('Storage delete error:', deleteError)
      }
    } catch (error) {
      console.error('Failed to parse storage URL:', error)
    }

    // 데이터베이스에서 프로필 사진 정보 제거
    const { error: updateError } = await supabase
      .from('member_profiles')
      .update({
        profile_photo_url: null,
        profile_photo_metadata: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.user.id)

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, message: '프로필 사진이 성공적으로 삭제되었습니다.' },
      { status: 200 }
    )

  } catch (error) {
    console.error('Profile photo delete error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * GET: 프로필 사진 메타데이터 조회
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

    // 프로필 사진 정보 조회
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('profile_photo_url, profile_photo_metadata')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      photo_url: profile.profile_photo_url,
      metadata: profile.profile_photo_metadata,
      has_photo: !!profile.profile_photo_url
    }, { status: 200 })

  } catch (error) {
    console.error('Profile photo metadata error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}