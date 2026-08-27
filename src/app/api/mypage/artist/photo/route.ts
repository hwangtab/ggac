/**
 * 아티스트 프로필 사진 관리 API 엔드포인트
 * PUT: 아티스트 프로필 사진 업로드/변경
 * DELETE: 아티스트 프로필 사진 삭제
 * GET: 아티스트 프로필 사진 메타데이터 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/server/rateLimit'
import { hasPublicBlobStore } from '@/lib/storage/blob'
import { putPublicObject, deletePublicObject, logicalPathFromUrl } from '@/lib/storage/provider'
import { buildVariantPathSuffixes } from '@/lib/storage/paths'
import { revalidatePath, revalidateTag } from 'next/cache'
import sharp from 'sharp'
import type { ProfilePhotoUploadResponse, ProfilePhotoMetadata, ImageCropSettings } from '@/types'
import { invalidateArtistsCache } from '@/lib/data'
import { getArtistCoreRevalidationPaths } from '@/lib/revalidationPaths'
import { hasValidFileSignature } from '@/utils/fileUploadValidation'
import { isProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { requireUser, requireActiveMember } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { getArtistPhotoInfoByLegacyId, updateArtistByLegacyId } from '@/db/queries/artists'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const WEBP_QUALITY = 82
const JPEG_QUALITY = 85

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
    // 사용자 인증 확인 (로그인 + 승인된 활성 조합원)
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인. 프로필 권위는 Turso다 — 이전엔 일반
    // 클라이언트로 조회해 비었으면 service-role로 재시도하는 이중 경로였지만
    // (Supabase RLS 우회 대비), Turso는 RLS 개념이 없어 단일 조회로 충분하다.
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('Profile lookup error:', error)
      profile = null
    }

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

    // 기존 아티스트 프로필 사진 조회. Task 4: artists 권위가 Turso로
    // 옮겨졌다 — Turso는 RLS 개념이 없어 일반/service-role 이중 조회가
    // 필요 없다(단일 조회로 충분, 위 프로필 조회와 같은 이유).
    let currentArtist: Awaited<ReturnType<typeof getArtistPhotoInfoByLegacyId>>
    try {
      currentArtist = await getArtistPhotoInfoByLegacyId(profile.artist_id)
    } catch (error) {
      // 조회 자체가 실패한 것(DB 장애)과 "행이 없다"는 다르다. 아래에서
      // 구분해 처리하려고 여기서는 sentinel을 던진다.
      console.error('Artist lookup error:', error)
      return NextResponse.json(
        {
          success: false,
          error: '아티스트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        },
        { status: 503 }
      )
    }

    // **업로드 전에** 아티스트 행이 실재하는지 판정한다.
    //
    // 예전에는 조회 결과가 null이어도 그대로 업로드를 진행했고, 마지막
    // UPDATE가 0행이라 500 `데이터베이스 업데이트에 실패했습니다.`로 끝났다.
    // 적대 감사(2026-08-27) 실측 — 운영에 `member_profiles.artist_id`가
    // 어떤 `artists` 행과도 매칭되지 않는 조합원이 **3명** 있다
    // (`artist-002`·`artist-003`·`artist-017`, 탈퇴 아티스트를 가리키는 끊어진
    // 참조다. `artist_id`에 FK가 없어 막히지 않았다).
    //
    // 그 3명은 사진을 등록·교체할 수 없는데 화면에는 원인을 알 수 없는 서버
    // 오류만 떴다. 게다가 유료 공개 스토어에 먼저 올린 뒤 실패하므로 시도마다
    // 롤백 삭제가 돌아야 했다 — 롤백이 실패하면 고아 객체가 남는다.
    //
    // 이제 업로드 전에 멈추고, 조합원이 무엇을 해야 할지 알 수 있는 메시지를 준다.
    if (!currentArtist) {
      console.error('Artist row not found for legacy_id', { artistId: profile.artist_id })
      return NextResponse.json(
        {
          success: false,
          error:
            '연결된 아티스트 정보를 찾을 수 없습니다. 사무국에 문의해 주세요(아티스트 연결이 끊어져 있습니다).',
        },
        { status: 409 }
      )
    }

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
    let updatedArtist: Awaited<ReturnType<typeof updateArtistByLegacyId>>
    try {
      updatedArtist = await updateArtistByLegacyId(profile.artist_id, {
        profile_photo_url: variantUrls.webp || variantUrls.fallback || variantUrls.original || null,
        profile_photo_metadata: finalMetadata as unknown as Record<string, unknown>,
      })
    } catch (error) {
      updatedArtist = null
      console.error('Database update error:', error)
    }

    if (!updatedArtist) {
      console.error('Database update error: artist row not found')

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

    // 기존 아티스트 프로필 사진 삭제 (Storage에서).
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
        Array.from(removalTargets).map(logical => deletePublicObject(logical))
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
    // 삭제 작업 전에 저장소 자격 증명을 미리 검증한다 — 실패 시 즉시 500으로
    // 응답한다. 아래 삭제 루프는 개별 실패를 로그만 남기고 삼키므로, 이
    // 검증이 없으면 토큰이 없는 배포에서 파일은 하나도 안 지워졌는데 DB만
    // 비워지고 200 성공 응답이 나간다.
    if (!hasPublicBlobStore()) {
      console.error('PUBLIC_BLOB_READ_WRITE_TOKEN 미설정 — 아티스트 사진 삭제 중단')
      return NextResponse.json(
        { success: false, error: '서버 설정 오류로 인해 삭제를 진행할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인. 프로필 권위는 Turso다.
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('Profile lookup error:', error)
      profile = null
    }

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

    // 현재 아티스트 프로필 사진 정보 조회. Task 4: artists 권위가 Turso로 옮겨졌다.
    let artist: Awaited<ReturnType<typeof getArtistPhotoInfoByLegacyId>>
    try {
      artist = await getArtistPhotoInfoByLegacyId(profile.artist_id)
    } catch (error) {
      console.error('Artist lookup error:', error)
      artist = null
    }

    if (!artist) {
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

    // Storage에서 파일 삭제.
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
          Array.from(removalTargets).map(logical => deletePublicObject(logical))
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
    let cleared: Awaited<ReturnType<typeof updateArtistByLegacyId>>
    try {
      cleared = await updateArtistByLegacyId(profile.artist_id, {
        profile_photo_url: null,
        profile_photo_metadata: null,
      })
    } catch (error) {
      cleared = null
      console.error('Database update error:', error)
    }

    if (!cleared) {
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
    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 아티스트 권한 확인. 프로필 권위는 Turso다.
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('Profile lookup error:', error)
      profile = null
    }

    if (!profile) {
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

    // 아티스트 프로필 사진 정보 조회. Task 4: artists 권위가 Turso로 옮겨졌다.
    let artist: Awaited<ReturnType<typeof getArtistPhotoInfoByLegacyId>>
    try {
      artist = await getArtistPhotoInfoByLegacyId(profile.artist_id)
    } catch (error) {
      console.error('Artist lookup error:', error)
      artist = null
    }

    if (!artist) {
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
