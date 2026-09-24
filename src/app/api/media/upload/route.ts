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
import sharp from 'sharp'
import { hasPublicBlobStore, listObjects } from '@/lib/storage/blob'
import { toMediaListing } from '@/lib/storage/mediaListing'
import type { MediaFile } from '@/types'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import distLimiter from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import {
  buildStoragePaths,
  checkMagicBytes,
  uploadImageWithVariants,
  validateUploadFile,
  type StorageUploadResult,
} from '@/lib/storage/imageUpload'
import { requireUser, requireActiveMember } from '@/lib/server/memberAuth'
import { FEATURE_DISABLED_MESSAGES, isFileUploadEnabled } from '@/lib/features/settings'
import { recordUpload } from '@/db/queries/uploads'

const log = createLogger('api/media/upload')

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

// 파일 타입·크기 검증은 공유 구현(@/lib/storage/imageUpload)이 한다.
function validateFile(
  file: File,
  bucket: AllowedBucket = 'attachments'
): { valid: boolean; error?: string } {
  return validateUploadFile(file, BUCKET_CONFIGS[bucket])
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
  return buildStoragePaths(getBucketPrefix(bucket, userId), userId, fileName)
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

/**
 * POST: 파일 업로드
 */
export async function POST(request: NextRequest) {
  try {
    // 파일 업로드 스위치. 이 라우트는 조합원이 **어디에 쓸지 모르는 파일**을
    // 올리는 곳이다 — 게시판 본문 이미지(`useImageUpload`)와 미디어 관리자가
    // 같은 주소로 올린다. 요청만 보고는 용도를 가를 수 없고, 클라이언트가
    // 보낸 용도 표시를 믿는 것은 스위치를 장식으로 만드는 일이다. 그래서 이
    // 스위치는 이 주소로 오는 **새 파일 전부**를 막는다.
    //
    // **펀딩 표지는 더 이상 여기로 오지 않는다.** 임자가 분명한 이미지는 그
    // 캠페인의 라우트(`/api/mypage/funding/campaigns/[id]/cover`)가 받고 펀딩
    // 스위치가 다스린다 — 게시판을 조용히 시키려고 이 스위치를 내리는 일이
    // 펀딩 편집기를 함께 멈추지 않게 하려는 것이다.
    //
    // 시스템·사무국 경로도 여기에 걸리지 않는다: 메일함 수신 첨부(웹훅)는
    // 꺼도 메일이 유실되면 안 되고, 이사회 서류는 비공개 서류함이라 이
    // 스위치가 말하는 "조합원 업로드"가 아니다.
    if ((await isFileUploadEnabled()) === false)
      return ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.fileUpload).toNextResponse()

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

    // 업로드 원장에 기록한다.
    //
    // 이 기록이 없으면 에디터에 삽입되지 않은 파일은 **추적할 수단 자체가
    // 없는 영구 고아**가 된다(참조가 남는 곳은 게시글 본문의 URL 문자열뿐이다).
    // 기록해 두면 정리 크론이 "올라왔지만 아무 데서도 참조하지 않는 파일"을
    // 골라 지울 수 있다.
    //
    // 실패해도 업로드는 성공으로 돌려준다 — 고아 파일 하나가 남는 쪽이,
    // 이미 Blob에 올라간 파일을 두고 사용자에게 "업로드 실패"를 말하는 쪽보다
    // 낫다(사용자는 재시도할 것이고 그러면 고아가 하나 더 생긴다).
    //
    // 기록하는 것은 **에디터에 삽입되는 대표 URL 하나**다. WebP·폴백 변형까지
    // 각각 기록하면 정리 크론이 "본문에 없는 변형"을 지워 OptimizedImage의
    // 폴백 사슬(WebP → JPEG → …)을 끊는다.
    const primaryPath = uploadResult.webp?.path || uploadResult.original.path
    const primaryUrl = variantUrls.webp || variantUrls.original || ''
    if (primaryUrl) {
      try {
        await recordUpload({
          user_id: user.id,
          bucket,
          path: primaryPath,
          url: primaryUrl,
          mime_type: uploadResult.webp?.contentType || uploadResult.original.contentType,
          size_bytes: uploadResult.webp?.size ?? uploadResult.original.size,
        })
      } catch (error) {
        log.error('업로드 원장 기록 실패(고아 파일이 될 수 있음)', { path: primaryPath, error })
      }
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
