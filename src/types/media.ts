/**
 * 미디어/프로필 사진 시스템 타입 정의
 */

/**
 * 프로필 사진 메타데이터 인터페이스
 */
export interface ProfilePhotoMetadata {
  /** 원본 파일명 */
  original_filename?: string
  /** 파일 크기 (바이트) */
  file_size?: number
  /** 콘텐츠 타입 */
  content_type?: string
  /** 이미지 너비 */
  width?: number
  /** 이미지 높이 */
  height?: number
  /** 업로드 시간 */
  uploaded_at?: string
  /** 처리 완료 여부 */
  processed?: boolean
  /** 저장된 변형 파일 경로 */
  variants?: {
    original: string
    webp?: string
    fallback?: string
  }
  /** 각 변형 파일의 공개 URL */
  variant_urls?: {
    original?: string
    webp?: string
    fallback?: string
  }
  /** 변형 파일의 추가 메타데이터 (파일 크기 등) */
  variant_metadata?: {
    original?: {
      size?: number
      content_type?: string
    }
    webp?: {
      size?: number
      content_type?: string
    }
    fallback?: {
      size?: number
      content_type?: string
    }
  }
  /** 다양한 크기의 이미지 버전들 */
  versions?: {
    thumbnail?: string
    medium?: string
    large?: string
  }
  /** 크롭 정보 */
  crop_info?: {
    x: number
    y: number
    width: number
    height: number
  }
}

/**
 * 프로필 사진 업로드 요청 인터페이스
 */
export interface ProfilePhotoUploadRequest {
  /** 업로드할 파일 */
  file: File
  /** 크롭 정보 (선택적) */
  crop_info?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** 대체 텍스트 */
  alt_text?: string
}

/**
 * 프로필 사진 업로드 응답 인터페이스
 */
export interface ProfilePhotoUploadResponse {
  /** 성공 여부 */
  success: boolean
  /** 업로드된 사진 URL */
  photo_url?: string
  /** 생성된 메타데이터 */
  metadata?: ProfilePhotoMetadata
  /** 공개 URL */
  public_url?: string
  /** 오류 메시지 */
  error?: string
}

/**
 * 미디어 파일 정보 인터페이스
 */
export interface MediaFile {
  /** 고유 식별자 */
  id: string
  /** 파일명 */
  name: string
  /** 파일 크기 */
  size: number
  /** 콘텐츠 타입 */
  type: string
  /** Storage 경로 */
  path: string
  /** 공개 URL */
  public_url: string
  /** 변형 파일 경로 모음 */
  variants?: {
    original: string
    webp?: string
    fallback?: string
  }
  /** 변형 파일의 공개 URL 모음 */
  variant_urls?: {
    original?: string
    webp?: string
    fallback?: string
  }
  /** 업로드 시간 */
  uploaded_at: string
  /** 메타데이터 */
  metadata: Record<string, any>
}

/**
 * 이미지 크롭 설정 인터페이스
 */
export interface ImageCropSettings {
  /** 크롭 영역 X 좌표 */
  x: number
  /** 크롭 영역 Y 좌표 */
  y: number
  /** 크롭 영역 너비 */
  width: number
  /** 크롭 영역 높이 */
  height: number
  /** 최종 출력 크기 */
  output_size?: {
    width: number
    height: number
  }
  /** 종횡비 유지 여부 */
  maintain_aspect_ratio?: boolean
  /** 크롭 종횡비 */
  aspectRatio?: number
}

/**
 * MediaManager 설정 인터페이스
 */
export interface MediaManagerConfig {
  /** 최대 파일 크기 (바이트) */
  max_file_size: number
  /** 허용된 파일 타입들 */
  allowed_types: string[]
  /** 최대 업로드 파일 수 */
  max_files: number
  /** 이미지 자동 리사이징 여부 */
  auto_resize: boolean
  /** 최대 이미지 해상도 */
  max_resolution: {
    width: number
    height: number
  }
  /** 품질 설정 (0-100) */
  quality: number
  /** WebP 변환 여부 */
  convert_to_webp: boolean
}
