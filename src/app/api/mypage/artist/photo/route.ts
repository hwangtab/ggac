/**
 * 아티스트 프로필 사진 관리 API 엔드포인트
 * PUT: 아티스트 프로필 사진 업로드/변경
 * DELETE: 아티스트 프로필 사진 삭제
 * GET: 아티스트 프로필 사진 메타데이터 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import sharp from 'sharp'
import type { ProfilePhotoUploadResponse, ProfilePhotoMetadata, ImageCropSettings } from '@/types'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const WEBP_QUALITY = 82
const JPEG_QUALITY = 85

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Supabase admin credentials are not configured')
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// 파일 타입 검증
function validateFileType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type)
}

// 파일 크기 검증
function validateFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE
}

// Storage 경로 생성 (아티스트용)
function generateArtistStoragePaths(artistId: string, originalFilename: string) {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = (originalFilename.split('.').pop() || 'jpg').toLowerCase()
  const baseName = `profile_${timestamp}_${randomId}`
  const basePath = `${artistId}/${baseName}`

  return {
    originalPath: `${basePath}.${extension}`,
    webpPath: `${basePath}.webp`,
    fallbackPath: `${basePath}.fallback.jpg`,
    extension,
  }
}

type AdminClient = ReturnType<typeof getSupabaseAdmin>

async function uploadImageWithVariants(
  supabase: AdminClient,
  bucket: string,
  paths: ReturnType<typeof generateArtistStoragePaths>,
  originalBuffer: Buffer,
  contentType: string
) {
  const variantPaths: NonNullable<ProfilePhotoMetadata['variants']> = {
    original: paths.originalPath,
  }
  const variantUrls: NonNullable<ProfilePhotoMetadata['variant_urls']> = {}
  const variantMetadata: NonNullable<ProfilePhotoMetadata['variant_metadata']> = {
    original: {
      size: originalBuffer.length,
      content_type: contentType,
    },
  }

  const { error: originalUploadError } = await supabase.storage
    .from(bucket)
    .upload(paths.originalPath, originalBuffer, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    })

  if (originalUploadError) {
    console.error('Artist photo original upload failed:', originalUploadError)
    return {
      success: false,
      error: '프로필 사진 업로드 중 오류가 발생했습니다.',
      variantPaths,
      variantUrls,
      variantMetadata,
    }
  }

  variantUrls.original = supabase.storage
    .from(bucket)
    .getPublicUrl(paths.originalPath).data?.publicUrl

  if (!contentType.includes('gif')) {
    try {
      const webpBuffer = await sharp(originalBuffer).webp({ quality: WEBP_QUALITY }).toBuffer()
      const { error: webpError } = await supabase.storage
        .from(bucket)
        .upload(paths.webpPath, webpBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/webp',
        })

      if (!webpError) {
        variantPaths.webp = paths.webpPath
        variantUrls.webp = supabase.storage
          .from(bucket)
          .getPublicUrl(paths.webpPath).data?.publicUrl
        variantMetadata.webp = {
          size: webpBuffer.length,
          content_type: 'image/webp',
        }
      } else {
        console.warn('Artist photo WebP upload failed:', webpError)
      }
    } catch (error) {
      console.warn('Artist photo WebP conversion failed:', error)
    }
  }

  const isOriginalJpeg = ['.jpg', '.jpeg'].includes(paths.extension)

  if (isOriginalJpeg) {
    variantPaths.fallback = paths.originalPath
    variantUrls.fallback = variantUrls.original
    variantMetadata.fallback = {
      size: originalBuffer.length,
      content_type: contentType,
    }
  } else {
    try {
      const jpegBuffer = await sharp(originalBuffer).jpeg({ quality: JPEG_QUALITY }).toBuffer()
      const { error: fallbackError } = await supabase.storage
        .from(bucket)
        .upload(paths.fallbackPath, jpegBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/jpeg',
        })

      if (!fallbackError) {
        variantPaths.fallback = paths.fallbackPath
        variantUrls.fallback = supabase.storage
          .from(bucket)
          .getPublicUrl(paths.fallbackPath).data?.publicUrl
        variantMetadata.fallback = {
          size: jpegBuffer.length,
          content_type: 'image/jpeg',
        }
      } else {
        console.warn('Artist photo JPEG fallback upload failed:', fallbackError)
      }
    } catch (error) {
      console.warn('Artist photo JPEG conversion failed:', error)
    }
  }

  return {
    success: true,
    variantPaths,
    variantUrls,
    variantMetadata,
  }
}

/**
 * PUT: 아티스트 프로필 사진 업로드/변경
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    let supabaseAdmin: AdminClient
    try {
      supabaseAdmin = getSupabaseAdmin()
    } catch (error) {
      console.error('Failed to initialise Supabase admin client:', error)
      return NextResponse.json(
        { success: false, error: '서버 설정 오류로 인해 업로드를 진행할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 })
    }

    // 사용자의 아티스트 권한 확인
    let profileQuery = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!profileQuery.data) {
      const adminResult = await supabaseAdmin
        .from('member_profiles')
        .select('artist_id, is_artist, registration_status, is_active')
        .eq('id', session.user.id)
        .maybeSingle()
      if (adminResult.error) {
        console.error('Admin profile lookup error:', adminResult.error)
      } else {
        profileQuery = adminResult
      }
    }

    const profile = profileQuery.data

    if (!profile) {
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
        {
          success: false,
          error: '승인된 활성 멤버만 아티스트 프로필 사진을 업로드할 수 있습니다.',
        },
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
        {
          success: false,
          error: '지원하지 않는 파일 형식입니다. JPEG, PNG, WebP, GIF만 가능합니다.',
        },
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
    let currentArtistQuery = await supabase
      .from('artists')
      .select('profile_photo_url, profile_photo_metadata')
      .eq('legacy_id', profile.artist_id)
      .maybeSingle()

    if (!currentArtistQuery.data) {
      const adminResult = await supabaseAdmin
        .from('artists')
        .select('profile_photo_url, profile_photo_metadata')
        .eq('legacy_id', profile.artist_id)
        .maybeSingle()
      if (adminResult.error) {
        console.error('Admin artist lookup error:', adminResult.error)
      } else {
        currentArtistQuery = adminResult
      }
    }

    const currentArtist = currentArtistQuery.data

    // Storage 경로 생성
    const storagePaths = generateArtistStoragePaths(profile.artist_id, file.name)
    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const uploadResult = await uploadImageWithVariants(
      supabaseAdmin,
      'artists',
      storagePaths,
      fileBuffer,
      file.type
    )
    if (!uploadResult.success) {
      return NextResponse.json({ success: false, error: uploadResult.error }, { status: 500 })
    }

    const variantUrls = uploadResult.variantUrls
    const variantPaths = uploadResult.variantPaths
    const variantMetadata = uploadResult.variantMetadata

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
      ...providedMetadata,
      variants: variantPaths,
      variant_urls: variantUrls,
      variant_metadata: variantMetadata,
    }

    // 아티스트 테이블 업데이트
    const { error: updateError } = await supabase
      .from('artists')
      .update({
        profile_photo_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
        profile_photo_metadata: finalMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('legacy_id', profile.artist_id)

    if (updateError) {
      console.error('Database update error:', updateError)

      // 실패 시 업로드된 파일 삭제
      const toRemove = [variantPaths.original, variantPaths.webp, variantPaths.fallback].filter(
        (value): value is string => Boolean(value)
      )

      if (toRemove.length > 0) {
        await supabaseAdmin.storage.from('artists').remove(toRemove)
      }

      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 기존 아티스트 프로필 사진 삭제 (Storage에서)
    const removalTargets = new Set<string>()
    if (currentArtist?.profile_photo_metadata?.variants) {
      const variants = currentArtist.profile_photo_metadata.variants
      if (variants.original) removalTargets.add(variants.original)
      if (variants.webp) removalTargets.add(variants.webp)
      if (variants.fallback) removalTargets.add(variants.fallback)
    } else if (currentArtist?.profile_photo_url) {
      try {
        const url = new URL(currentArtist.profile_photo_url)
        const pathParts = url.pathname.split('/')
        const fileName = pathParts[pathParts.length - 1]
        removalTargets.add(`${profile.artist_id}/${fileName}`)
      } catch (error) {
        console.error('Failed to parse previous photo URL for cleanup:', error)
      }
    }

    if (removalTargets.size > 0) {
      try {
        await supabaseAdmin.storage.from('artists').remove(Array.from(removalTargets))
      } catch (error) {
        console.error('Failed to delete previous artist photo variants:', error)
      }
    }

    // 성공 응답
    const response: ProfilePhotoUploadResponse = {
      success: true,
      photo_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
      metadata: finalMetadata,
      public_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
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
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 })
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
      const filePath = `${profile.artist_id}/${fileName}`

      const { error: deleteError } = await supabase.storage.from('artists').remove([filePath])

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
        updated_at: new Date().toISOString(),
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
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 })
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

    return NextResponse.json(
      {
        success: true,
        photo_url: artist.profile_photo_url,
        metadata: artist.profile_photo_metadata,
        has_photo: !!artist.profile_photo_url,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Artist photo metadata error:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
