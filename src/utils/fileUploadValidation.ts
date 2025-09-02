/**
 * 파일 업로드 검증 공통 유틸리티
 * 
 * 모든 파일 업로드 API에서 사용할 수 있는 표준화된 검증 로직을 제공합니다.
 * - 파일 타입 및 확장자 검증
 * - 파일 크기 검증
 * - MIME 타입 일치성 검증
 * - 파일명 보안 검증
 * - 고유 파일명 생성
 */

export interface FileValidationConfig {
  /** 허용된 파일 타입들 */
  allowedTypes: readonly string[]
  /** 최대 파일 크기 (바이트) */
  maxFileSize: number
  /** 총 파일 크기 제한 (바이트, 선택사항) */
  maxTotalSize?: number
  /** 최대 파일 개수 (선택사항) */
  maxFiles?: number
  /** 파일 타입별 개별 크기 제한 (선택사항) */
  typeSizeLimits?: Record<string, number>
}

export interface FileValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  fileType?: 'image' | 'document' | 'video' | 'audio'
  sanitizedFileName?: string
  uniqueFileName?: string
}

export interface BatchValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  validFiles: File[]
  rejectedFiles: Array<{ file: File; errors: string[] }>
  totalSize: number
}

// 미리 정의된 설정 프로파일
export const FILE_VALIDATION_PROFILES = {
  // 게시글 첨부파일용
  POST_ATTACHMENTS: {
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav'
    ],
    maxFileSize: 5 * 1024 * 1024, // 5MB
    maxTotalSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
    typeSizeLimits: {
      'image': 5 * 1024 * 1024,    // 5MB
      'document': 10 * 1024 * 1024, // 10MB
      'video': 50 * 1024 * 1024,    // 50MB
      'audio': 20 * 1024 * 1024     // 20MB
    }
  },
  
  // 프로필 사진용
  PROFILE_PHOTOS: {
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxFileSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 1
  },
  
  // 일반 미디어용
  GENERAL_MEDIA: {
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'video/mp4', 'video/webm'
    ],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 50
  }
} as const

// 파일 타입 매핑
const FILE_TYPE_MAPPING: Record<string, 'image' | 'document' | 'video' | 'audio'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio'
}

// 확장자별 예상 MIME 타입
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.mp4': ['video/mp4'],
  '.webm': ['video/webm'],
  '.mp3': ['audio/mpeg'],
  '.wav': ['audio/wav']
}

/**
 * 파일 확장자 추출
 */
function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return ''
  }
  return fileName.substring(lastDotIndex).toLowerCase()
}

/**
 * 파일 타입 추출
 */
function getFileType(mimeType: string): 'image' | 'document' | 'video' | 'audio' | undefined {
  return FILE_TYPE_MAPPING[mimeType]
}

/**
 * 파일명 보안 검증
 */
function validateFileName(fileName: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // 기본 파일명 검증
  if (!fileName || fileName.trim().length === 0) {
    errors.push('파일명이 비어있습니다.')
    return { isValid: false, errors }
  }
  
  // 길이 제한
  if (fileName.length > 255) {
    errors.push('파일명이 너무 깁니다. (최대 255자)')
  }
  
  // 위험한 문자 검증
  const dangerousChars = /[<>:"|?*\x00-\x1f]/
  if (dangerousChars.test(fileName)) {
    errors.push('파일명에 허용되지 않는 문자가 포함되어 있습니다.')
  }
  
  // 예약어 검증 (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(fileName)) {
    errors.push('시스템 예약어는 파일명으로 사용할 수 없습니다.')
  }
  
  // 숨겨진 파일 검증
  if (fileName.startsWith('.')) {
    errors.push('숨겨진 파일은 업로드할 수 없습니다.')
  }
  
  return { isValid: errors.length === 0, errors }
}

/**
 * 파일명 정제 및 고유 파일명 생성
 */
function generateSafeUniqueFileName(originalName: string, userId?: string): string {
  // 파일명 정제
  const extension = getFileExtension(originalName)
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '') // 안전한 문자만 유지
    .replace(/\s+/g, '_') // 공백을 언더스코어로
    .substring(0, 50) // 길이 제한
    .trim()
  
  // 고유 식별자 생성
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const userPrefix = userId ? `${userId.substring(0, 8)}_` : ''
  
  return `${userPrefix}${timestamp}_${randomId}_${baseName}${extension}`
}

/**
 * 단일 파일 검증
 */
export function validateFile(
  file: File, 
  config: FileValidationConfig,
  existingFiles?: File[],
  userId?: string
): FileValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  // 1. 파일명 검증
  const fileNameValidation = validateFileName(file.name)
  if (!fileNameValidation.isValid) {
    errors.push(...fileNameValidation.errors)
  }
  
  // 2. 파일 타입 검증
  if (!config.allowedTypes.includes(file.type)) {
    const allowedTypesStr = config.allowedTypes
      .map(type => type.split('/')[1].toUpperCase())
      .join(', ')
    errors.push(`지원하지 않는 파일 형식입니다. 허용된 형식: ${allowedTypesStr}`)
  }
  
  // 3. 확장자와 MIME 타입 일치성 검증
  const extension = getFileExtension(file.name)
  if (extension) {
    const expectedMimeTypes = EXTENSION_MIME_MAP[extension]
    if (expectedMimeTypes && !expectedMimeTypes.includes(file.type)) {
      errors.push(`파일 확장자(${extension})와 파일 형식(${file.type})이 일치하지 않습니다.`)
    }
  }
  
  // 4. 파일 크기 검증
  const fileType = getFileType(file.type)
  const maxSize = fileType && config.typeSizeLimits?.[fileType] 
    ? config.typeSizeLimits[fileType] 
    : config.maxFileSize
    
  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / 1024 / 1024).toFixed(1)
    errors.push(`파일 크기가 너무 큽니다. 최대 ${maxSizeMB}MB까지 허용됩니다.`)
  }
  
  // 5. 빈 파일 검증
  if (file.size === 0) {
    errors.push('빈 파일은 업로드할 수 없습니다.')
  }
  
  // 6. 파일 개수 제한 검증
  if (config.maxFiles && existingFiles) {
    if (existingFiles.length >= config.maxFiles) {
      errors.push(`최대 ${config.maxFiles}개의 파일만 업로드할 수 있습니다.`)
    }
  }
  
  // 7. 총 크기 제한 검증
  if (config.maxTotalSize && existingFiles) {
    const currentTotalSize = existingFiles.reduce((sum, f) => sum + f.size, 0)
    if (currentTotalSize + file.size > config.maxTotalSize) {
      const maxTotalSizeMB = (config.maxTotalSize / 1024 / 1024).toFixed(1)
      errors.push(`총 파일 크기 제한을 초과합니다. 최대 ${maxTotalSizeMB}MB까지 허용됩니다.`)
    }
  }
  
  // 파일명 정제
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_\-.\s]/g, '_')
  const uniqueFileName = generateSafeUniqueFileName(file.name, userId)
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    fileType,
    sanitizedFileName,
    uniqueFileName
  }
}

/**
 * 다중 파일 일괄 검증
 */
export function validateFiles(
  files: File[],
  config: FileValidationConfig,
  existingFiles: File[] = [],
  userId?: string
): BatchValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const validFiles: File[] = []
  const rejectedFiles: Array<{ file: File; errors: string[] }> = []
  
  // 전체 파일 개수 검증
  if (config.maxFiles && files.length + existingFiles.length > config.maxFiles) {
    errors.push(`파일 개수 제한을 초과했습니다. 최대 ${config.maxFiles}개까지 업로드 가능합니다.`)
    return {
      isValid: false,
      errors,
      warnings,
      validFiles: [],
      rejectedFiles: files.map(file => ({ file, errors: ['파일 개수 제한 초과'] })),
      totalSize: 0
    }
  }
  
  let currentFiles = [...existingFiles]
  
  // 각 파일 개별 검증
  for (const file of files) {
    const validation = validateFile(file, config, currentFiles, userId)
    
    if (validation.isValid) {
      validFiles.push(file)
      currentFiles.push(file)
      warnings.push(...validation.warnings)
    } else {
      rejectedFiles.push({
        file,
        errors: validation.errors
      })
    }
  }
  
  // 총 크기 계산
  const totalSize = currentFiles.reduce((sum, file) => sum + file.size, 0)
  
  return {
    isValid: validFiles.length > 0 && errors.length === 0,
    errors,
    warnings,
    validFiles,
    rejectedFiles,
    totalSize
  }
}

/**
 * 파일 크기를 읽기 쉬운 형식으로 변환
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = (bytes / Math.pow(1024, i)).toFixed(1)
  
  return `${size} ${sizes[i]}`
}

/**
 * 파일 타입 아이콘 추천
 */
export function getFileTypeIcon(mimeType: string): 'image' | 'video' | 'audio' | 'file' {
  const fileType = getFileType(mimeType)
  if (fileType === 'document') return 'file'
  return fileType || 'file'
}

/**
 * 에러 메시지 포맷팅
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) return ''
  if (errors.length === 1) return errors[0]
  
  return errors.map((error, index) => `${index + 1}. ${error}`).join('\n')
}