/**
 * "이미지를 안전하게 검사해서 저장한다"의 **한 벌**.
 *
 * 원래 이 코드는 `src/app/api/media/upload/route.ts` 안에만 있었다. 펀딩 표지가
 * 자기 라우트를 갖게 되면서 같은 일을 하는 자리가 둘이 됐고, 매직 바이트
 * 대조·크기 상한·변형 생성처럼 **틀리면 구멍이 되는 검사**는 사본이 갈라지는
 * 순간 한쪽만 고쳐진다. 그래서 그 검사들을 여기로 옮기고 두 라우트가 같은
 * 함수를 부른다.
 *
 * ## 여기 있는 것
 *
 * - `checkMagicBytes` — 선언된 MIME과 파일 선두 바이트가 맞는지. 표에 없는
 *   타입은 **거부**한다(헤더만 믿지 않는다).
 * - `validateUploadFile` — 타입 허용 목록과 크기 상한.
 * - `buildStoragePaths` — 안전한 파일명 + 원본/WebP/JPEG 폴백 세 경로.
 * - `uploadImageWithVariants` — 원본을 올리고 WebP·JPEG 폴백을 만들어 올린다.
 *
 * ## 여기 없는 것
 *
 * `src/utils/fileUploadValidation.ts`에도 매직 바이트 표가 따로 있다(게시판
 * 첨부·아티스트 사진이 쓴다). 두 표는 다루는 타입이 다르고(그쪽은 hwp·docx·
 * xls까지) MP4 판정 방식도 다르다. 합치는 것은 그 세 화면을 전부 다시
 * 검증해야 하는 일이라 이번 변경에 얹지 않았다 — 이 파일은 **media/upload가
 * 쓰던 표 하나**를 옮겼을 뿐이고, 새 라우트도 그 하나를 쓴다. 새 사본을 만들지
 * 않는 것이 이 파일의 목적이다.
 */
import path from 'path'
import sharp from 'sharp'

import { putPublicObject } from '@/lib/storage/provider'
import { buildVariantPathSuffixes } from '@/lib/storage/paths'
import { createLogger } from '@/utils/logger'

const log = createLogger('lib/storage/imageUpload')

// 매직 바이트 시그니처 (서버 사이드 Buffer 기반)
//
// 각 서명은 { bytes, offset? }다 — offset 생략 시 0(파일 선두)에서 매칭한다.
// MP4(ISO BMFF)는 박스 구조상 `ftyp` 태그가 항상 offset 4에 온다(앞 4바이트는
// 가변 박스 크기 필드라 대조 대상이 아니다) — 예전에는 이걸 prefix 매칭
// 함수로만 검사하려고 흔한 박스 크기(32/24/28바이트) 세 가지를 하드코딩한
// 패턴으로 흉내 냈는데, 그 크기가 아닌 실제 MP4 파일은 걸러졌다. 지금은
// checkMagicBytes가 offset을 직접 지원하므로 실제 구조 그대로 한 줄로 검사한다.
export const MAGIC_BYTE_SIGNATURES: Record<string, { bytes: number[]; offset?: number }[]> = {
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

export function checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTE_SIGNATURES[mimeType]
  // 알 수 없는 타입은 거부한다(MIME 헤더만 믿지 않는다) — event-applications/photo
  // 라우트가 이미 이 계약이었고, 여기만 반대(통과)였던 불일치를 없앤다.
  if (!signatures) return false
  return signatures.some(({ bytes, offset = 0 }) =>
    bytes.every((byte, i) => buffer[offset + i] === byte)
  )
}

/** 이미지 한 장만 받는 자리(펀딩 표지 등)가 쓰는 허용 목록. */
export const IMAGE_ONLY_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export const WEBP_QUALITY = 82
export const JPEG_QUALITY = 85

export type UploadLimits = {
  allowed_types: readonly string[]
  max_file_size: number
}

/** 선언된 타입과 크기를 본다. 파일 **내용** 대조는 `checkMagicBytes`가 따로 한다. */
export function validateUploadFile(
  file: File,
  limits: UploadLimits
): { valid: boolean; error?: string } {
  if (!limits.allowed_types.includes(file.type)) {
    return {
      valid: false,
      error: `지원하지 않는 파일 형식입니다. 허용된 형식: ${limits.allowed_types.join(', ')}`,
    }
  }

  if (file.size > limits.max_file_size) {
    const maxSizeMB = (limits.max_file_size / 1024 / 1024).toFixed(1)
    return {
      valid: false,
      error: `파일 크기가 너무 큽니다. 최대 ${maxSizeMB}MB까지 가능합니다.`,
    }
  }

  return { valid: true }
}

// 안전한 파일명 생성
export function generateSafeFileName(originalName: string, userId: string): string {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = originalName.split('.').pop()?.toLowerCase() || 'bin'
  const baseName = originalName
    .split('.')[0]
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50)

  return `${userId}_${timestamp}_${randomId}_${baseName}.${extension}`
}

export type StoragePaths = {
  originalPath: string
  webpPath: string
  fallbackPath: string
  extension: string
  basePrefix: string
  baseName: string
}

/** 저장 경로 세 벌을 만든다. `basePrefix` 아래 규칙은 호출부가 정한다. */
export function buildStoragePaths(
  basePrefix: string,
  userId: string,
  fileName: string
): StoragePaths {
  const safeFileName = generateSafeFileName(fileName, userId)
  const extension = path.extname(safeFileName).toLowerCase()
  const nameWithoutExtension = extension
    ? safeFileName.slice(0, safeFileName.length - extension.length)
    : safeFileName

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

export interface StorageUploadResult {
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

export async function uploadImageWithVariants(
  bucket: string,
  paths: StoragePaths,
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
