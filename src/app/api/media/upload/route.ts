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
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { MediaFile } from '@/types'
import { createSuccessResponse, createErrorResponse, createJsonResponse } from '@/utils/apiResponse'
import distLimiter from '@/utils/distributedRateLimiter'

// Service Role 클라이언트는 Storage 작업에만 사용
function getSupabaseAdmin() {
  console.log('[SUPABASE ADMIN] 환경 변수 확인')
  console.log('[SUPABASE ADMIN] SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('[SUPABASE ADMIN] SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
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

// 파일 타입 검증
function validateFile(
  file: File,
  bucket: string = 'attachments'
): { valid: boolean; error?: string } {
  const config = BUCKET_CONFIGS[bucket as keyof typeof BUCKET_CONFIGS] || {
    max_file_size: DEFAULT_MAX_FILE_SIZE,
    allowed_types: DEFAULT_ALLOWED_TYPES,
  }

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
function getBucketPrefix(bucket: string, userId: string) {
  switch (bucket) {
    case 'profiles':
      return `profiles/${userId}`
    case 'attachments':
      return `attachments/${userId}`
    default:
      return `general/${userId}`
  }
}

function generateStoragePaths(bucket: string, userId: string, fileName: string) {
  const safeFileName = generateSafeFileName(fileName, userId)
  const extension = path.extname(safeFileName).toLowerCase()
  const nameWithoutExtension = extension
    ? safeFileName.slice(0, safeFileName.length - extension.length)
    : safeFileName

  const basePrefix = getBucketPrefix(bucket, userId)

  const originalPath = `${basePrefix}/${safeFileName}`
  const webpPath = `${basePrefix}/${nameWithoutExtension}.webp`
  const fallbackPath = `${basePrefix}/${nameWithoutExtension}.fallback.jpg`

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
      console.warn('이미지 크기 추출 실패:', error)
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

async function uploadFileToStorage(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  bucket: string,
  filePath: string,
  buffer: Buffer,
  contentType: string,
  upsert: boolean = false
) {
  return supabaseAdmin.storage.from(bucket).upload(filePath, buffer, {
    cacheControl: '3600',
    upsert,
    contentType,
  })
}

async function uploadImageWithVariants(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
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

  const { error: originalUploadError } = await uploadFileToStorage(
    supabaseAdmin,
    bucket,
    paths.originalPath,
    originalBuffer,
    originalContentType,
    false
  )

  if (originalUploadError) {
    throw new Error(`원본 파일 업로드 실패: ${originalUploadError.message}`)
  }

  const { data: originalUrlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(paths.originalPath)
  result.original.url = originalUrlData?.publicUrl || ''

  // GIF는 Sharp 변환 시 애니메이션이 손실될 수 있으므로 변환 생략
  const shouldGenerateVariants =
    originalContentType.startsWith('image/') && !['image/gif'].includes(originalContentType)

  if (!shouldGenerateVariants) {
    return result
  }

  // WebP 변환
  const webpBuffer = await sharp(originalBuffer).webp({ quality: WEBP_QUALITY }).toBuffer()
  const { error: webpUploadError } = await uploadFileToStorage(
    supabaseAdmin,
    bucket,
    paths.webpPath,
    webpBuffer,
    'image/webp',
    true
  )

  if (!webpUploadError) {
    const { data: webpUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(paths.webpPath)
    result.webp = {
      path: paths.webpPath,
      url: webpUrlData?.publicUrl || '',
      size: webpBuffer.length,
      contentType: 'image/webp',
    }
  } else {
    console.warn('WebP 변환 업로드 실패:', webpUploadError)
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
  const { error: jpegUploadError } = await uploadFileToStorage(
    supabaseAdmin,
    bucket,
    paths.fallbackPath,
    jpegBuffer,
    'image/jpeg',
    true
  )

  if (!jpegUploadError) {
    const { data: jpegUrlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(paths.fallbackPath)
    result.fallback = {
      path: paths.fallbackPath,
      url: jpegUrlData?.publicUrl || '',
      size: jpegBuffer.length,
      contentType: 'image/jpeg',
    }
  } else {
    console.warn('JPEG 폴백 업로드 실패:', jpegUploadError)
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

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return createErrorResponse('로그인이 필요합니다.', 401)
    }

    // 사용자 상태 확인 (승인된 멤버만)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      return createErrorResponse('사용자 정보를 찾을 수 없습니다.', 404)
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return createErrorResponse('승인된 활성 멤버만 파일을 업로드할 수 있습니다.', 403)
    }

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File
    const bucket = (formData.get('bucket') as string) || 'attachments'
    const metadataStr = formData.get('metadata') as string

    if (!file) {
      return createErrorResponse('파일이 제공되지 않았습니다.', 400)
    }

    // 파일 유효성 검사
    const validation = validateFile(file, bucket)
    if (!validation.valid) {
      return createErrorResponse(validation.error!, 400)
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
    const storagePaths = generateStoragePaths(bucket, session.user.id, file.name)

    // Storage 클라이언트 생성 및 파일 업로드
    let supabaseAdmin
    try {
      supabaseAdmin = getSupabaseAdmin()
      console.log('[UPLOAD API] Storage 클라이언트 생성 성공')
    } catch (error) {
      console.error('[UPLOAD API] Supabase Admin 클라이언트 생성 오류:', error)
      return createErrorResponse('Storage 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.', 503)
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    let uploadResult: StorageUploadResult
    try {
      uploadResult = await uploadImageWithVariants(
        supabaseAdmin,
        bucket,
        storagePaths,
        fileBuffer,
        file.type
      )
    } catch (error: any) {
      console.error('Storage upload error:', error)
      const message =
        typeof error?.message === 'string' ? error.message : '파일 업로드에 실패했습니다.'
      if (message.includes('bucket') || message.includes('not found')) {
        return createErrorResponse(
          'Storage가 설정되지 않았습니다. 관리자가 Supabase Storage bucket을 생성해야 합니다.',
          503
        )
      }
      return createErrorResponse(`파일 업로드에 실패했습니다: ${message}`, 500)
    }

    console.log('[UPLOAD API] Storage 업로드 성공:', uploadResult.original.path)

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
    const res = createSuccessResponse({
      file: mediaFile,
      // 호환성을 위한 추가 필드들
      id: mediaFile.id,
      name: mediaFile.name,
      path: mediaFile.path,
      public_url: mediaFile.public_url,
      metadata: finalMetadata,
      variants: mediaFile.variants,
      variant_urls: mediaFile.variant_urls,
    })
    return distLimiter.addRateLimitHeaders(
      res,
      distLimiter.CONFIGS.FILE_UPLOAD.maxRequests,
      limit.remaining,
      limit.resetTime
    )
  } catch (error) {
    console.error('Media upload error:', error)
    return createErrorResponse('서버 오류가 발생했습니다.', 500)
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
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return createErrorResponse('로그인이 필요합니다.', 401)
    }

    const { searchParams } = new URL(request.url)
    const bucket = searchParams.get('bucket') || 'attachments'
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Storage 클라이언트 생성
    let supabaseAdmin
    try {
      supabaseAdmin = getSupabaseAdmin()
    } catch (error) {
      console.error('[LIST API] Supabase Admin 클라이언트 생성 오류:', error)
      return createErrorResponse('Storage 서비스를 사용할 수 없습니다.', 503)
    }

    // Storage에서 사용자 파일 목록 조회
    const basePrefix = getBucketPrefix(bucket, session.user.id)
    const listPrefix = `${basePrefix}/`

    const { data: files, error: listError } = await supabaseAdmin.storage
      .from(bucket)
      .list(listPrefix, {
        limit,
        offset,
        sortBy: { column: 'created_at', order: 'desc' },
      })

    if (listError) {
      console.error('Storage list error:', listError)
      return createErrorResponse('파일 목록 조회에 실패했습니다.', 500)
    }

    const allFileNames = new Set((files || []).map(file => file.name))

    // MediaFile 형태로 변환 (WebP/폴백 파일은 목록에서 제외하고 메타데이터로 제공)
    const mediaFiles: MediaFile[] = (files || [])
      .filter(file => {
        if (!file.name) return false
        if (file.name.endsWith('.webp')) return false
        if (file.name.endsWith('.fallback.jpg')) return false
        return true
      })
      .map((file, index) => {
        const filePath = `${basePrefix}/${file.name}`
        const ext = path.extname(file.name)
        const baseName = ext ? file.name.slice(0, file.name.length - ext.length) : file.name

        const webpName = `${baseName}.webp`
        const fallbackName = `${baseName}.fallback.jpg`

        const variantPaths = {
          original: filePath,
          webp: allFileNames.has(webpName) ? `${basePrefix}/${webpName}` : undefined,
          fallback: allFileNames.has(fallbackName)
            ? `${basePrefix}/${fallbackName}`
            : ['.jpg', '.jpeg'].includes(ext.toLowerCase())
              ? filePath
              : undefined,
        }

        const { data: originalUrlData } = supabaseAdmin.storage
          .from(bucket)
          .getPublicUrl(variantPaths.original)
        const { data: webpUrlData } = variantPaths.webp
          ? supabaseAdmin.storage.from(bucket).getPublicUrl(variantPaths.webp)
          : { data: undefined }
        const { data: fallbackUrlData } = variantPaths.fallback
          ? supabaseAdmin.storage.from(bucket).getPublicUrl(variantPaths.fallback)
          : { data: undefined }

        const variantUrls = {
          original: originalUrlData?.publicUrl,
          webp: webpUrlData?.publicUrl,
          fallback: fallbackUrlData?.publicUrl,
        }

        return {
          id: `${bucket}-${file.name}-${index}`,
          name: file.name,
          size: file.metadata?.size || 0,
          type: file.metadata?.mimetype || 'application/octet-stream',
          path: variantPaths.webp || variantPaths.original,
          public_url: variantUrls.webp || variantUrls.original || '',
          variants: variantPaths,
          variant_urls: variantUrls,
          uploaded_at: file.created_at || new Date().toISOString(),
          metadata: {
            ...(file.metadata || {}),
            variants: variantPaths,
            variant_urls: variantUrls,
          },
        }
      })

    const resList = createSuccessResponse({
      files: mediaFiles,
      total: mediaFiles.length,
      has_more: mediaFiles.length === limit,
    })
    return distLimiter.addRateLimitHeaders(
      resList,
      distLimiter.CONFIGS.SEARCH_API.maxRequests,
      gLimit.remaining,
      gLimit.resetTime
    )
  } catch (error) {
    console.error('Media list error:', error)
    return createErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
