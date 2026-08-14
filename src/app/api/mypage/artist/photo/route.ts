/**
 * 아티스트 프로필 사진 관리 API 엔드포인트
 * PUT: 아티스트 프로필 사진 업로드/변경
 * DELETE: 아티스트 프로필 사진 삭제
 * GET: 아티스트 프로필 사진 메타데이터 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/server/rateLimit'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import {
  putPublicObject,
  deletePublicObject,
  deletePublicObjectEverywhere,
  logicalPathFromUrl,
} from '@/lib/storage/provider'
import { buildVariantPathSuffixes } from '@/lib/storage/paths'
import { revalidatePath, revalidateTag } from 'next/cache'
import sharp from 'sharp'
import type { ProfilePhotoUploadResponse, ProfilePhotoMetadata, ImageCropSettings } from '@/types'
import { invalidateArtistsCache } from '@/lib/data'
import { getArtistCoreRevalidationPaths } from '@/lib/revalidationPaths'
import { hasValidFileSignature } from '@/utils/fileUploadValidation'
import { isProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { requireUser, requireActiveMember } from '@/lib/server/memberAuth'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const WEBP_QUALITY = 82
const JPEG_QUALITY = 85

function getSupabaseAdmin() {
  return createServiceRoleClient()
}

// 파일 타입 검증
function validateFileType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type)
}

// 파일 크기 검증
function validateFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE
}

function parseJsonObject(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (error) {
    console.error('Invalid JSON form field:', error)
    return {}
  }
}

function parseCropSettings(value: FormDataEntryValue | null): ImageCropSettings | undefined {
  const parsed = parseJsonObject(value)
  const x = parsed.x
  const y = parsed.y
  const width = parsed.width
  const height = parsed.height

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }

  const cropSettings: ImageCropSettings = { x, y, width, height }
  const outputSize = parsed.output_size
  if (outputSize && typeof outputSize === 'object' && !Array.isArray(outputSize)) {
    const output = outputSize as Record<string, unknown>
    if (
      typeof output.width === 'number' &&
      typeof output.height === 'number' &&
      Number.isFinite(output.width) &&
      Number.isFinite(output.height) &&
      output.width > 0 &&
      output.height > 0
    ) {
      cropSettings.output_size = {
        width: output.width,
        height: output.height,
      }
    }
  }
  if (typeof parsed.maintain_aspect_ratio === 'boolean') {
    cropSettings.maintain_aspect_ratio = parsed.maintain_aspect_ratio
  }
  if (typeof parsed.aspectRatio === 'number' && Number.isFinite(parsed.aspectRatio)) {
    cropSettings.aspectRatio = parsed.aspectRatio
  }

  return cropSettings
}

async function getImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(buffer).metadata()
    return {
      width: metadata.width,
      height: metadata.height,
    }
  } catch (error) {
    console.warn('Artist photo dimension extraction failed:', error)
    return {}
  }
}

// Storage 경로 생성 (아티스트용)
function generateArtistStoragePaths(artistId: string, originalFilename: string) {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = (originalFilename.split('.').pop() || 'jpg').toLowerCase()
  const baseName = `profile_${timestamp}_${randomId}`
  const { originalPath, webpPath, fallbackPath } = buildVariantPathSuffixes(
    artistId,
    `${baseName}.${extension}`,
    baseName
  )

  return {
    originalPath,
    webpPath,
    fallbackPath,
    extension,
  }
}

type AdminClient = ReturnType<typeof getSupabaseAdmin>

function collectSafeArtistVariantPaths(
  metadata: ProfilePhotoMetadata | null | undefined,
  artistId: string
): string[] {
  const variants = metadata?.variants
  const paths = [variants?.original, variants?.webp, variants?.fallback]
  return paths.filter((value): value is string => {
    if (!value) return false
    const isSafePath = isProjectStorageObjectPath(value, artistId)
    if (!isSafePath) {
      console.warn('Unsafe artist photo variant path skipped for cleanup')
    }
    return isSafePath
  })
}

async function uploadImageWithVariants(
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

  try {
    const { url } = await putPublicObject(
      `${bucket}/${paths.originalPath}`,
      originalBuffer,
      contentType
    )
    variantUrls.original = url
  } catch (error) {
    console.error('Artist photo original upload failed:', error)
    return {
      success: false,
      error: '프로필 사진 업로드 중 오류가 발생했습니다.',
      variantPaths,
      variantUrls,
      variantMetadata,
    }
  }

  if (!contentType.includes('gif')) {
    try {
      const webpBuffer = await sharp(originalBuffer).webp({ quality: WEBP_QUALITY }).toBuffer()
      try {
        // 입력이 이미 .webp면 webpPath === paths.originalPath다(같은 명명
        // 규칙 때문 — buildVariantPathSuffixes 참고). 원본 업로드가 이미 그
        // 경로를 차지했으므로 여기서는 overwrite:true가 필수다. 원본
        // 업로드는 계속 기본값(false)을 쓴다.
        const { url } = await putPublicObject(
          `${bucket}/${paths.webpPath}`,
          webpBuffer,
          'image/webp',
          { overwrite: true }
        )
        variantPaths.webp = paths.webpPath
        variantUrls.webp = url
        variantMetadata.webp = {
          size: webpBuffer.length,
          content_type: 'image/webp',
        }
      } catch (error) {
        console.warn('Artist photo WebP upload failed:', error)
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
      try {
        // fallbackPath는 항상 .fallback.jpg가 붙어 원본/webp와 겹치지 않지만,
        // 이 라우트가 원래 upsert:true로 재업로드를 허용해 온 동작을 그대로
        // 유지한다.
        const { url } = await putPublicObject(
          `${bucket}/${paths.fallbackPath}`,
          jpegBuffer,
          'image/jpeg',
          { overwrite: true }
        )
        variantPaths.fallback = paths.fallbackPath
        variantUrls.fallback = url
        variantMetadata.fallback = {
          size: jpegBuffer.length,
          content_type: 'image/jpeg',
        }
      } catch (error) {
        console.warn('Artist photo JPEG fallback upload failed:', error)
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
  // sharp 변환을 동반하는 업로드 — 무한 반복 시 CPU·Storage 소모 방지 (전수감사 M-4)
  const rl = await rateLimit(request, 'FILE_UPLOAD')
  if (!rl.success) {
    return rl.response ?? NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 })
  }

  try {
    const supabase = await createSupabaseServer()
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

    // 사용자 인증 확인 (로그인 + 승인된 활성 조합원)
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인
    let profileQuery = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (!profileQuery.data) {
      const adminResult = await supabaseAdmin
        .from('member_profiles')
        .select('artist_id, is_artist, registration_status, is_active')
        .eq('id', user.id)
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

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file')
    const cropSettingsValue = formData.get('crop_settings')

    if (!file || !(file instanceof File)) {
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

    const cropSettings = parseCropSettings(cropSettingsValue)

    // 기존 아티스트 프로필 사진 조회
    let currentArtistQuery = await supabase
      .from('artists')
      .select('profile_photo_url, profile_photo_metadata, slug')
      .eq('legacy_id', profile.artist_id)
      .maybeSingle()

    if (!currentArtistQuery.data) {
      const adminResult = await supabaseAdmin
        .from('artists')
        .select('profile_photo_url, profile_photo_metadata, slug')
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
    if (!hasValidFileSignature(fileBuffer, file.type)) {
      return NextResponse.json(
        { success: false, error: '파일 내용이 선언된 파일 형식과 일치하지 않습니다.' },
        { status: 400 }
      )
    }
    const imageDimensions = await getImageDimensions(fileBuffer)

    const uploadResult = await uploadImageWithVariants(
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
      width: imageDimensions.width,
      height: imageDimensions.height,
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

      // 실패 시 업로드된 파일 삭제 — 방금 이 요청에서 현재 제공자로 올린
      // 파일을 되돌리는 롤백이므로 단일 제공자 삭제로 충분하다. 다만
      // .webp 업로드는 originalPath === webpPath가 될 수 있어(Task 4에서
      // 확인된 buildVariantPathSuffixes의 성질) Set으로 중복 경로를 제거한다.
      const toRemove = Array.from(
        new Set(
          [variantPaths.original, variantPaths.webp, variantPaths.fallback].filter(
            (value): value is string => Boolean(value)
          )
        )
      )

      if (toRemove.length > 0) {
        const rollbackResults = await Promise.allSettled(
          toRemove.map(path => deletePublicObject(`artists/${path}`))
        )
        for (const result of rollbackResults) {
          if (result.status === 'rejected') {
            console.error('Failed to roll back uploaded artist photo variant:', result.reason)
          }
        }
      }

      return NextResponse.json(
        { success: false, error: '데이터베이스 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 기존 아티스트 프로필 사진 삭제 (Storage에서) — 전환기에는 이전 파일이
    // 어느 제공자에 있는지 알 수 없으므로 양쪽 다 지운다.
    // removalTargets는 버킷을 포함한 논리 경로(`artists/...`)로 통일한다 —
    // logicalPathFromUrl이 이미 그 형태를 돌려주므로, collectSafeArtistVariantPaths가
    // 주는 버킷 상대 경로 쪽에 `artists/`를 붙여 맞춘다.
    const removalTargets = new Set<string>()
    collectSafeArtistVariantPaths(currentArtist?.profile_photo_metadata, profile.artist_id).forEach(
      path => removalTargets.add(`artists/${path}`)
    )
    if (removalTargets.size === 0 && currentArtist?.profile_photo_url) {
      const legacyLogical = logicalPathFromUrl(
        currentArtist.profile_photo_url,
        'artists',
        profile.artist_id
      )
      if (legacyLogical) {
        removalTargets.add(legacyLogical)
      } else {
        console.warn('Unsafe previous artist photo URL skipped for cleanup')
      }
    }

    if (removalTargets.size > 0) {
      const results = await Promise.allSettled(
        Array.from(removalTargets).map(logical => deletePublicObjectEverywhere(logical))
      )
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('Failed to delete previous artist photo variants:', result.reason)
        }
      }
    }

    // 성공 응답
    const response: ProfilePhotoUploadResponse = {
      success: true,
      photo_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
      metadata: finalMetadata,
      public_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
    }

    // 캐시 무효화 — ko(내부 rewrite 경로 `/ko/...`)와 en(`/en/...`) 두 로케일
    // 경로를 모두 무효화한다. 홈은 FeaturedArtists 섹션에서 아티스트 사진을
    // 보여주므로 함께 무효화 대상에 포함한다. 자세한 배경은
    // @/lib/revalidationPaths 참고.
    try {
      revalidateTag('artists')
      for (const revalidationPath of getArtistCoreRevalidationPaths(currentArtist?.slug)) {
        revalidatePath(revalidationPath)
      }
      invalidateArtistsCache()
    } catch (error) {
      console.warn('Failed to revalidate artist caches:', error)
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
    const supabase = await createSupabaseServer()

    // 자격 증명으로 Service Role 클라이언트를 만들 수 있는지 삭제 작업 전에
    // 미리 검증한다 — 실패 시 즉시 500으로 응답한다. (결과 자체를 변수에
    // 담아두진 않는다: 아래 스토리지 삭제는 deletePublicObjectEverywhere가
    // 내부적으로 자체 클라이언트를 만들어 쓰므로 이 클라이언트를 재사용하지
    // 않는다 — 그 재사용 부분만 죽은 코드였고, 사전 검증이라는 동작은
    // 그대로 유지한다. 이 검증이 없으면 Supabase 자격 증명만 깨진 상태에서
    // Blob 쪽 삭제가 멱등하게 "성공"해 shouldThrow가 false로 떨어지고,
    // 실제 파일은 남았는데 200 성공 응답이 나가는 시나리오가 생긴다.)
    try {
      getSupabaseAdmin()
    } catch (error) {
      console.error('Failed to initialise Supabase admin client:', error)
      return NextResponse.json(
        { success: false, error: '서버 설정 오류로 인해 삭제를 진행할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', user.id)
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
      .select('profile_photo_url, profile_photo_metadata, slug')
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

    // Storage에서 파일 삭제 — 전환기에는 이전 파일이 어느 제공자에 있는지
    // 알 수 없으므로 양쪽 다 지운다.
    // removalTargets는 버킷을 포함한 논리 경로(`artists/...`)로 통일한다.
    try {
      const removalTargets = new Set<string>()
      collectSafeArtistVariantPaths(artist.profile_photo_metadata, profile.artist_id).forEach(
        path => removalTargets.add(`artists/${path}`)
      )

      if (removalTargets.size === 0) {
        const legacyLogical = logicalPathFromUrl(
          artist.profile_photo_url,
          'artists',
          profile.artist_id
        )
        if (legacyLogical) {
          removalTargets.add(legacyLogical)
        } else {
          console.warn('Unsafe artist photo URL skipped for cleanup')
        }
      }

      if (removalTargets.size > 0) {
        const results = await Promise.allSettled(
          Array.from(removalTargets).map(logical => deletePublicObjectEverywhere(logical))
        )
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error('Storage delete error:', result.reason)
          }
        }
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

    // ko(내부 rewrite 경로 `/ko/...`)와 en(`/en/...`) 두 로케일 경로를 모두
    // 무효화한다. 홈은 FeaturedArtists 섹션에서 아티스트 사진을 보여주므로
    // 함께 무효화한다. 자세한 배경은 @/lib/revalidationPaths 참고.
    try {
      revalidateTag('artists')
      for (const revalidationPath of getArtistCoreRevalidationPaths(artist.slug)) {
        revalidatePath(revalidationPath)
      }
      invalidateArtistsCache()
    } catch (error) {
      console.warn('Failed to revalidate artist caches after delete:', error)
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
    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist')
      .eq('id', user.id)
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
