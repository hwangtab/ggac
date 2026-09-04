/**
 * 범용 미디어 업로드 API 엔드포인트
 * MediaManager 컴포넌트에서 사용하는 범용 파일 업로드 API
 */

// Next.js 14 App Router 설정
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import sharp from 'sharp'
import { hasPublicBlobStore, listObjects } from '@/lib/storage/blob'
import { toMediaListing } from '@/lib/storage/mediaListing'
import type { MediaFile } from '@/types'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import distLimiter from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { putPublicObject } from '@/lib/storage/provider'
import { buildVariantPathSuffixes } from '@/lib/storage/paths'
import { requireUser, requireActiveMember } from '@/lib/server/memberAuth'

const log = createLogger('api/media/upload')

// 매직 바이트 시그니처 (서버 사이드 Buffer 기반)
//
// 각 서명은 { bytes, offset? }다 — offset 생략 시 0(파일 선두)에서 매칭한다.
// MP4(ISO BMFF)는 박스 구조상 `ftyp` 태그가 항상 offset 4에 온다(앞 4바이트는
// 가변 박스 크기 필드라 대조 대상이 아니다) — 예전에는 이걸 prefix 매칭
// 함수로만 검사하려고 흔한 박스 크기(32/24/28바이트) 세 가지를 하드코딩한
// 패턴으로 흉내 냈는데, 그 크기가 아닌 실제 MP4 파일은 걸러졌다. 지금은
// checkMagicBytes가 offset을 직접 지원하므로 실제 구조 그대로 한 줄로 검사한다.
const MAGIC_BYTE_SIGNATURES: Record<string, { bytes: number[]; offset?: number }[]> = {
  'image/jpeg': [{ bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }],
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
  // PDF: %PDF
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
  // MP4: ftyp 박스 태그, offset 4(앞 4바이트는 가변 박스 크기)
  'video/mp4': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  // WebM: EBML 헤더(Matroska와 공유하는 시그니처)
  'video/webm': [{ bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  // MP3: ID3 태그가 있으면 그것으로, 없으면 프레임 싱크(MPEG-1/2 Layer III
  // 후보 세 종류)로 판정한다 — 인코더에 따라 어느 쪽만 있을 수 있어 여러
  // 후보를 모두 허용해야 한다.
  'audio/mpeg': [
    { bytes: [0x49, 0x44, 0x33] }, // ID3
    { bytes: [0xff, 0xfb] },
    { bytes: [0xff, 0xf3] },
    { bytes: [0xff, 0xf2] },
  ],
}

function checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTE_SIGNATURES[mimeType]
  // 알 수 없는 타입은 거부한다(MIME 헤더만 믿지 않는다) — event-applications/photo
  // 라우트가 이미 이 계약이었고, 여기만 반대(통과)였던 불일치를 없앤다.
  if (!signatures) return false
  return signatures.some(({ bytes, offset = 0 }) =>
    bytes.every((byte, i) => buffer[offset + i] === byte)
  )
}

// 기본 설정
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
]

const WEBP_QUALITY = 82
const JPEG_QUALITY = 85
const RESERVED_METADATA_KEYS = new Set([
  'original_filename',
  'file_size',
  'content_type',
  'uploaded_at',
  'width',
  'height',
  'variants',
  'variant_urls',
  'variant_metadata',
])

// 버킷별 설정
const BUCKET_CONFIGS = {
  profiles: {
    max_file_size: 2 * 1024 * 1024, // 2MB
    allowed_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  attachments: {
    max_file_size: 50 * 1024 * 1024, // 50MB
    allowed_types: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
    ],
  },
}

type AllowedBucket = keyof typeof BUCKET_CONFIGS

function isAllowedBucket(bucket: string): bucket is AllowedBucket {
  return bucket in BUCKET_CONFIGS
}

function parseMetadataObject(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (error) {
    log.error('Invalid metadata', error)
    return {}
  }
}

function sanitizeUserMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => {
      if (RESERVED_METADATA_KEYS.has(key)) return false
      return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    })
  )
}

// 파일 타입 검증
function validateFile(
  file: File,
  bucket: AllowedBucket = 'attachments'
): { valid: boolean; error?: string } {
  const config = BUCKET_CONFIGS[bucket]

  if (!config.allowed_types.includes(file.type)) {
    return {
      valid: false,
      error: `지원하지 않는 파일 형식입니다. 허용된 형식: ${config.allowed_types.join(', ')}`,
    }
  }

  if (file.size > config.max_file_size) {
    const maxSizeMB = (config.max_file_size / 1024 / 1024).toFixed(1)
    return {
      valid: false,
      error: `파일 크기가 너무 큽니다. 최대 ${maxSizeMB}MB까지 가능합니다.`,
    }
  }

  return { valid: true }
}

// 안전한 파일명 생성
function generateSafeFileName(originalName: string, userId: string): string {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = originalName.split('.').pop()?.toLowerCase() || 'bin'
  const baseName = originalName
    .split('.')[0]
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50)

  return `${userId}_${timestamp}_${randomId}_${baseName}.${extension}`
}

// Storage 경로 생성 및 이미지 변형 경로 계산
function getBucketPrefix(bucket: AllowedBucket, userId: string) {
  switch (bucket) {
    case 'profiles':
      return `profiles/${userId}`
    case 'attachments':
      return `attachments/${userId}`
  }
}

function generateStoragePaths(bucket: AllowedBucket, userId: string, fileName: string) {
  const safeFileName = generateSafeFileName(fileName, userId)
  const extension = path.extname(safeFileName).toLowerCase()
  const nameWithoutExtension = extension
    ? safeFileName.slice(0, safeFileName.length - extension.length)
    : safeFileName

  const basePrefix = getBucketPrefix(bucket, userId)
  const { originalPath, webpPath, fallbackPath } = buildVariantPathSuffixes(
    basePrefix,
    safeFileName,
    nameWithoutExtension
  )

  return {
    originalPath,
    webpPath,
    fallbackPath,
    extension,
    basePrefix,
    baseName: nameWithoutExtension,
  }
}

// 파일 메타데이터 추출
async function extractFileMetadata(file: File, buffer?: Buffer): Promise<Record<string, any>> {
  const metadata: Record<string, any> = {
    original_filename: file.name,
    file_size: file.size,
    content_type: file.type,
    uploaded_at: new Date().toISOString(),
  }

  // 이미지 파일인 경우 크기 정보 추출
  if (file.type.startsWith('image/')) {
    try {
      const sourceBuffer = buffer || Buffer.from(await file.arrayBuffer())
      const imageMetadata = await sharp(sourceBuffer).metadata()

      if (imageMetadata.width && imageMetadata.height) {
        metadata.width = imageMetadata.width
        metadata.height = imageMetadata.height
      }
    } catch (error) {
      log.warn('이미지 크기 추출 실패', error)
      // 크기 추출 실패해도 업로드는 계속 진행
    }
  }

  return metadata
}

interface StorageUploadResult {
  original: {
    path: string
    url: string
    size: number
    contentType: string
  }
  webp?: {
    path: string
    url: string
    size: number
    contentType: string
  }
  fallback?: {
    path: string
    url: string
    size: number
    contentType: string
  }
}

async function uploadImageWithVariants(
  bucket: string,
  paths: ReturnType<typeof generateStoragePaths>,
  originalBuffer: Buffer,
  originalContentType: string
): Promise<StorageUploadResult> {
  const result: StorageUploadResult = {
    original: {
      path: paths.originalPath,
      url: '',
      size: originalBuffer.length,
      contentType: originalContentType,
    },
  }

  try {
    const { url } = await putPublicObject(
      `${bucket}/${paths.originalPath}`,
      originalBuffer,
      originalContentType
    )
    result.original.url = url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`원본 파일 업로드 실패: ${message}`)
  }

  // GIF는 Sharp 변환 시 애니메이션이 손실될 수 있으므로 변환 생략
  const shouldGenerateVariants =
    originalContentType.startsWith('image/') && !['image/gif'].includes(originalContentType)

  if (!shouldGenerateVariants) {
    return result
  }

  // WebP 변환
  const webpBuffer = await sharp(originalBuffer).webp({ quality: WEBP_QUALITY }).toBuffer()
  try {
    // 입력이 이미 .webp면 webpPath === paths.originalPath다(같은 명명 규칙
    // 때문 — buildVariantPathSuffixes 참고). 원본 업로드가 이미 그 경로를
    // 차지했으므로 여기서는 overwrite:true가 필수다. 원본 업로드는 계속
    // 기본값(false)을 쓴다.
    const { url } = await putPublicObject(`${bucket}/${paths.webpPath}`, webpBuffer, 'image/webp', {
      overwrite: true,
    })
    result.webp = {
      path: paths.webpPath,
      url,
      size: webpBuffer.length,
      contentType: 'image/webp',
    }
  } catch (error) {
    log.warn('WebP 변환 업로드 실패', error)
  }

  // JPG 폴백 생성 (원본이 이미 JPEG라면 재사용)
  const isOriginalJpeg = ['.jpg', '.jpeg'].includes(paths.extension)
  if (isOriginalJpeg) {
    result.fallback = {
      path: paths.originalPath,
      url: result.original.url,
      size: originalBuffer.length,
      contentType: originalContentType,
    }
    return result
  }

  const jpegBuffer = await sharp(originalBuffer).jpeg({ quality: JPEG_QUALITY }).toBuffer()
  try {
    // fallbackPath는 원본과 절대 같은 문자열이 될 수 없다(항상 .fallback.jpg가
    // 붙으므로) — 그래도 media/upload가 upsert:true로 재업로드를 허용해 온
    // 기존 동작을 그대로 유지한다(같은 요청을 재시도하는 경우 등).
    const { url } = await putPublicObject(
      `${bucket}/${paths.fallbackPath}`,
      jpegBuffer,
      'image/jpeg',
      { overwrite: true }
    )
    result.fallback = {
      path: paths.fallbackPath,
      url,
      size: jpegBuffer.length,
      contentType: 'image/jpeg',
    }
  } catch (error) {
    log.warn('JPEG 폴백 업로드 실패', error)
  }

  return result
}

/**
 * POST: 파일 업로드
 */
export async function POST(request: NextRequest) {
  try {
    // 분산 레이트리밋: 파일 업로드 시간당 10회
    const limiter = await distLimiter.applyRateLimit({
      ...distLimiter.CONFIGS.FILE_UPLOAD,
      keyGenerator: distLimiter.createUserKeyGenerator('upload'),
    })
    const limit = await limiter(request)
    if (!limit.success && limit.response) {
      return limit.response
    }

    // 사용자 인증 확인 (승인된 활성 멤버만 업로드 가능)
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file')
    const bucket = ((formData.get('bucket') as string) || 'attachments').trim()
    const metadataValue = formData.get('metadata')

    if (!file || !(file instanceof File)) {
      return ApiError.badRequest('파일이 제공되지 않았습니다.').toNextResponse()
    }
    if (!isAllowedBucket(bucket)) {
      return ApiError.badRequest('지원하지 않는 Storage bucket입니다.').toNextResponse()
    }

    // 파일 유효성 검사
    const validation = validateFile(file, bucket)
    if (!validation.valid) {
      return ApiError.badRequest(validation.error!).toNextResponse()
    }

    // 사용자 제공 메타데이터는 서버가 만든 파일 진실값을 덮어쓰지 못한다.
    const userMetadata = sanitizeUserMetadata(parseMetadataObject(metadataValue))

    // Storage 경로 생성
    const storagePaths = generateStoragePaths(bucket, user.id, file.name)

    // Storage 자격 증명 확인 (putPublicObject가 내부적으로 다시 확인하지만,
    // 여기서 먼저 확인해 설정 오류를 구분된 응답으로 돌려준다)
    if (!hasPublicBlobStore()) {
      log.error('PUBLIC_BLOB_READ_WRITE_TOKEN 미설정 (UPLOAD)')
      return ApiError.serviceUnavailable(
        'Storage 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.'
      ).toNextResponse()
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // 매직 바이트 검증 (파일 내용이 MIME 타입과 일치하는지 확인)
    if (!checkMagicBytes(fileBuffer, file.type)) {
      return ApiError.badRequest(
        '파일 내용이 선언된 파일 형식과 일치하지 않습니다.'
      ).toNextResponse()
    }

    let uploadResult: StorageUploadResult
    try {
      uploadResult = await uploadImageWithVariants(bucket, storagePaths, fileBuffer, file.type)
    } catch (error: unknown) {
      log.error('Storage upload error', error)
      const message = error instanceof Error ? error.message : ''
      if (message.includes('bucket') || message.includes('not found')) {
        return ApiError.serviceUnavailable(
          'Storage가 설정되지 않았습니다. 관리자가 Supabase Storage bucket을 생성해야 합니다.'
        ).toNextResponse()
      }
      return ApiError.internalServerError('파일 업로드에 실패했습니다.').toNextResponse()
    }

    log.debug('Storage 업로드 성공', { path: uploadResult.original.path })

    const variantUrls = {
      original: uploadResult.original.url,
      webp: uploadResult.webp?.url,
      fallback: uploadResult.fallback?.url,
    }

    // 파일 메타데이터 추출
    const fileMetadata = await extractFileMetadata(file, fileBuffer)
    const finalMetadata = {
      ...fileMetadata,
      ...userMetadata,
      variants: {
        original: uploadResult.original.path,
        webp: uploadResult.webp?.path,
        fallback: uploadResult.fallback?.path,
      },
      variant_urls: variantUrls,
      variant_metadata: {
        original: {
          size: uploadResult.original.size,
          content_type: uploadResult.original.contentType,
        },
        webp: uploadResult.webp
          ? {
              size: uploadResult.webp.size,
              content_type: uploadResult.webp.contentType,
            }
          : undefined,
        fallback: uploadResult.fallback
          ? {
              size: uploadResult.fallback.size,
              content_type: uploadResult.fallback.contentType,
            }
          : undefined,
      },
    }

    // MediaFile 객체 생성
    const mediaFile: MediaFile = {
      id: `upload-${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      type: file.type,
      path: uploadResult.webp?.path || uploadResult.original.path,
      public_url: variantUrls.webp || variantUrls.original || '',
      variants: {
        original: uploadResult.original.path,
        webp: uploadResult.webp?.path,
        fallback: uploadResult.fallback?.path,
      },
      variant_urls: variantUrls,
      uploaded_at: new Date().toISOString(),
      metadata: finalMetadata,
    }

    // 성공 응답
    const res = ApiSuccess.created({
      file: mediaFile,
      id: mediaFile.id,
      name: mediaFile.name,
      path: mediaFile.path,
      public_url: mediaFile.public_url,
      metadata: finalMetadata,
      variants: mediaFile.variants,
      variant_urls: mediaFile.variant_urls,
    }).toNextResponse()
    return distLimiter.addRateLimitHeaders(
      res,
      distLimiter.CONFIGS.FILE_UPLOAD.maxRequests,
      limit.remaining,
      limit.resetTime
    )
  } catch (error) {
    log.error('Media upload error', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

/**
 * GET: 업로드된 파일 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    // 목록 조회는 분당 30회 제한
    const gLimiter = await distLimiter.applyRateLimit({
      ...distLimiter.CONFIGS.SEARCH_API,
      keyGenerator: distLimiter.createUserKeyGenerator('upload_list'),
    })
    const gLimit = await gLimiter(request)
    if (!gLimit.success && gLimit.response) {
      return gLimit.response
    }
    // 사용자 인증 확인 (목록 조회는 로그인만 확인하고 승인 여부는 보지 않는다)
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const { searchParams } = new URL(request.url)
    const bucket = (searchParams.get('bucket') || 'attachments').trim()
    if (!isAllowedBucket(bucket)) {
      return ApiError.badRequest('지원하지 않는 Storage bucket입니다.').toNextResponse()
    }
    const limit = parseIntegerParam(searchParams.get('limit'), 50, { min: 1, max: 100 })
    const offset = parseIntegerParam(searchParams.get('offset'), 0, { min: 0 })

    // 저장소 자격 증명 확인 — 없으면 listObjects가 환경변수 이름이 담긴
    // 예외를 던진다.
    if (!hasPublicBlobStore()) {
      log.error('PUBLIC_BLOB_READ_WRITE_TOKEN 미설정 (LIST)')
      return ApiError.serviceUnavailable('Storage 서비스를 사용할 수 없습니다.').toNextResponse()
    }

    // Storage에서 사용자 파일 목록 조회.
    //
    // Blob `list()`는 offset을 받지 않고 커서만 준다. 이 저장소의 사용자별
    // 업로드 규모(회원 23명)에서는 limit+offset만큼 한 번에 받아 잘라내는
    // 쪽이 커서를 왕복시키는 것보다 단순하고 결과도 같다. 상한(1000)은
    // listObjects가 강제한다.
    const basePrefix = getBucketPrefix(bucket, user.id)
    let objects: Awaited<ReturnType<typeof listObjects>>
    try {
      objects = await listObjects('public', `${bucket}/${basePrefix}/`, limit + offset)
    } catch (listError) {
      log.error('Storage list error', listError)
      return ApiError.internalServerError('파일 목록 조회에 실패했습니다.').toNextResponse()
    }

    // 최신순 정렬은 예전 Supabase `sortBy: { column: 'created_at', order: 'desc' }`가
    // 하던 일이다. Blob 목록은 정렬을 보장하지 않으므로 여기서 직접 한다 —
    // 빼먹으면 목록이 매번 다른 순서로 나오고 offset 페이지네이션이 깨진다.
    objects.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())

    // MediaFile 형태로 변환 (WebP/폴백 파일은 목록에서 제외하고 메타데이터로 제공).
    // 변형 파일이 목록에서 빠지므로, 잘라내기는 변환 뒤에 해야 페이지당 개수가
    // 예전과 같아진다.
    const mediaFiles = toMediaListing(objects, bucket, basePrefix).slice(offset, offset + limit)

    const resList = ApiSuccess.ok({
      files: mediaFiles,
      total: mediaFiles.length,
      has_more: mediaFiles.length === limit,
    }).toNextResponse()
    return distLimiter.addRateLimitHeaders(
      resList,
      distLimiter.CONFIGS.SEARCH_API.maxRequests,
      gLimit.remaining,
      gLimit.resetTime
    )
  } catch (error) {
    log.error('Media list error', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
