/**
 * 아티스트 프로필 사진 관리 API 엔드포인트
 * PUT: 아티스트 프로필 사진 업로드/변경
 * DELETE: 아티스트 프로필 사진 삭제
 * GET: 아티스트 프로필 사진 메타데이터 조회
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

// 최대 파일 크기 (5MB - 아티스트 사진은 더 큰 사이즈 허용)
const MAX_FILE_SIZE = 5 * 1024 * 1024

// 파일 타입 검증
function validateFileType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type)
}

// 파일 크기 검증
function validateFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE
}

// Storage 경로 생성 (아티스트용)
function generateArtistStoragePath(artistId: string, fileExtension: string): string {
  const timestamp = Date.now()
  return `artists/${artistId}/profile_${timestamp}.${fileExtension}`
}

// 파일 확장자 추출
function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop()?.toLowerCase() || 'jpg' : 'jpg'
}

/**
 * PUT: 아티스트 프로필 사진 업로드/변경
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

    // 사용자의 아티스트 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return NextResponse.json(
        { success: false, error: '아티스트 권한이 없습니다.' },
        { status: 403 }
      )
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { success: false, error: '승인된 활성 멤버만 아티스트 프로필 사진을 업로드할 수 있습니다.' },
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
        { success: false, error: '파일 크기가 너무 큽니다. 최대 5MB까지 가능합니다.' },
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

    // 기존 아티스트 프로필 사진 조회
    const { data: currentArtist } = await supabase
      .from('artists')
      .select('profile_photo_url')
      .eq('legacy_id', profile.artist_id)
      .single()

    // Storage 경로 생성
    const fileExtension = getFileExtension(file.name)
    const storagePath = generateArtistStoragePath(profile.artist_id, fileExtension)

    // Supabase Storage에 파일 업로드
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('artists')
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
      .from('artists')
      .getPublicUrl(storagePath)

    if (!publicUrlData?.publicUrl) {
      return NextResponse.json(
        { success: false, error: '공개 URL 생성에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 최종 메타데이터 생성 (서버 사이드에서는 클라이언트 제공 메타데이터 사용)
    const finalMetadata: ProfilePhotoMetadata = {
      original_filename: file.name,
      file_size: file.size,
      content_type: file.type,
      uploaded_at: new Date().toISOString(),
      processed: true,
      crop_info: cropSettings,
      // 클라이언트에서 제공된 이미지 크기 정보 사용
      width: providedMetadata.width,
      height: providedMetadata.height,
      ...providedMetadata
    }

    // 아티스트 테이블 업데이트
    const { error: updateError } = await supabase
      .from('artists')
      .update({
        profile_photo_url: publicUrlData.publicUrl,
        profile_photo_metadata: finalMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('legacy_id', profile.artist_id)

    if (updateError) {
      console.error('Database update error:', updateError)
      
      // 실패 시 업로드된 파일 삭제
      await supabase.storage
        .from('artists')
        .remove([storagePath])

      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 기존 아티스트 프로필 사진 삭제 (Storage에서)
    if (currentArtist?.profile_photo_url) {
      try {
        // URL에서 파일 경로 추출
        const url = new URL(currentArtist.profile_photo_url)
        const pathParts = url.pathname.split('/')
        const fileName = pathParts[pathParts.length - 1]
        const oldPath = `artists/${profile.artist_id}/${fileName}`

        await supabase.storage
          .from('artists')
          .remove([oldPath])
      } catch (error) {
        console.error('Failed to delete old artist photo:', error)
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
    console.error('Artist photo upload error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * DELETE: 아티스트 프로필 사진 삭제
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

    // 사용자의 아티스트 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return NextResponse.json(
        { success: false, error: '아티스트 권한이 없습니다.' },
        { status: 403 }
      )
    }

    // 현재 아티스트 프로필 사진 정보 조회
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('profile_photo_url')
      .eq('legacy_id', profile.artist_id)
      .single()

    if (artistError || !artist) {
      return NextResponse.json(
        { success: false, error: '아티스트 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    if (!artist.profile_photo_url) {
      return NextResponse.json(
        { success: false, error: '삭제할 프로필 사진이 없습니다.' },
        { status: 400 }
      )
    }

    // Storage에서 파일 삭제
    try {
      const url = new URL(artist.profile_photo_url)
      const pathParts = url.pathname.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const filePath = `artists/${profile.artist_id}/${fileName}`

      const { error: deleteError } = await supabase.storage
        .from('artists')
        .remove([filePath])

      if (deleteError) {
        console.error('Storage delete error:', deleteError)
      }
    } catch (error) {
      console.error('Failed to parse storage URL:', error)
    }

    // 데이터베이스에서 아티스트 프로필 사진 정보 제거
    const { error: updateError } = await supabase
      .from('artists')
      .update({
        profile_photo_url: null,
        profile_photo_metadata: null,
        updated_at: new Date().toISOString()
      })
      .eq('legacy_id', profile.artist_id)

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, message: '아티스트 프로필 사진이 성공적으로 삭제되었습니다.' },
      { status: 200 }
    )

  } catch (error) {
    console.error('Artist photo delete error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * GET: 아티스트 프로필 사진 메타데이터 조회
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

    // 사용자의 아티스트 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '사용자 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    if (!profile.is_artist || !profile.artist_id) {
      return NextResponse.json(
        { success: false, error: '아티스트 권한이 없습니다.' },
        { status: 403 }
      )
    }

    // 아티스트 프로필 사진 정보 조회
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('profile_photo_url, profile_photo_metadata')
      .eq('legacy_id', profile.artist_id)
      .single()

    if (artistError || !artist) {
      return NextResponse.json(
        { success: false, error: '아티스트 정보를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      photo_url: artist.profile_photo_url,
      metadata: artist.profile_photo_metadata,
      has_photo: !!artist.profile_photo_url
    }, { status: 200 })

  } catch (error) {
    console.error('Artist photo metadata error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}