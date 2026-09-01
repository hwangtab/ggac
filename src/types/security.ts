export type SecurityEventType =
  // 기본 보안 이벤트
  | 'INVALID_UUID_OR_TEMP_ID_FORMAT'
  | 'TEMP_ID_USAGE'
  | 'MALICIOUS_UUID_ATTEMPT'
  | 'SUSPICIOUS_PATTERN_DETECTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'XSS_ATTEMPT'
  | 'XSS_PATTERN_DETECTED'
  | 'INJECTION_ATTEMPT'
  | 'FILE_UPLOAD_VIOLATION'
  | 'INVALID_FILE_TYPE'
  | 'SUSPICIOUS_FILE_UPLOAD'
  | 'AUTHENTICATION_FAILURE'
  | 'SESSION_MANIPULATION'

  // 콘텐츠 보안 이벤트
  | 'CONTENT_VALIDATION_FAILED'
  | 'MALICIOUS_CONTENT_BLOCKED'
  | 'UNSAFE_HTML_DETECTED'
  | 'BLOCKED_IMAGE_PROXY_REQUEST'
  | 'UNSAFE_URL_BLOCKED'
  | 'CONTENT_SIZE_VIOLATION'
  | 'CSP_VIOLATION'
  | 'CONTENT_SANITIZED'

  // 이미지 프록시 보안 이벤트
  | 'IMAGE_PROXY_BLOCKED_DOMAIN'
  | 'IMAGE_PROXY_INVALID_URL'
  | 'IMAGE_PROXY_SIZE_EXCEEDED'
  | 'IMAGE_PROXY_TIMEOUT'
  | 'IMAGE_PROXY_FETCH_ERROR'
  | 'IMAGE_PROXY_ERROR'
  | 'BLOCKED_IMAGE_DOMAIN'
  | 'MALICIOUS_IMAGE_DOMAIN'

  // Rate Limiting 이벤트
  | 'RATE_LIMIT_GENERAL_API_EXCEEDED'
  | 'RATE_LIMIT_AUTH_API_EXCEEDED'
  | 'RATE_LIMIT_ADMIN_API_EXCEEDED'
  | 'RATE_LIMIT_POST_CREATION_EXCEEDED'
  | 'RATE_LIMIT_SEARCH_API_EXCEEDED'
  | 'RATE_LIMIT_FILE_UPLOAD_EXCEEDED'
  | 'RATE_LIMIT_BULK_OPERATIONS_EXCEEDED'
  | 'RATE_LIMIT_BLOCKED_ACCESS'
  | 'RATE_LIMIT_AUTO_BLOCK'
  | 'RATE_LIMIT_MEMORY_FALLBACK'
  | 'RATE_LIMIT_DEGRADED_FAIL_OPEN'

  // Admin API 보안 이벤트
  | 'ADMIN_ACTIVITY_API_ERROR'
  | 'ADMIN_MEMBERS_API_ERROR'
  | 'ADMIN_MEMBER_APPROVAL_ERROR'
  | 'ADMIN_MEMBER_UPDATE_ERROR'
  | 'ADMIN_MEMBER_ACTION_ERROR'
  // 프로필 없는 계정("유령 회원") 복구 — 단계 4 Task 6b.
  // 관리자가 남의 계정에 프로필을 만드는 쓰기이므로 감사 로그에 남긴다.
  | 'ORPHAN_PROFILE_RECOVERED'
  | 'ADMIN_POSTS_API_ERROR'
  | 'ADMIN_POST_DELETE_ERROR'
  | 'ADMIN_POST_UPDATE_ERROR'
  | 'ADMIN_ARTISTS_API_ERROR'
  | 'ADMIN_ARTIST_UPDATE_ERROR'
  | 'ADMIN_ARTIST_DELETE_ERROR'
  | 'ADMIN_NOTIFICATIONS_API_ERROR'
  | 'ADMIN_NOTIFICATION_CREATE_ERROR'
  | 'ADMIN_NOTIFICATION_UPDATE_ERROR'
  | 'ADMIN_NOTIFICATION_DELETE_ERROR'
  | 'ADMIN_REPORTS_API_ERROR'
  | 'ADMIN_SETTINGS_API_ERROR'
  | 'ADMIN_SETTINGS_UPDATE_ERROR'
  | 'ADMIN_SETTINGS_ACCESS_ERROR'
  | 'ADMIN_SETTINGS_UPDATED'
  | 'ADMIN_SETTINGS_BACKUP_CREATED'
  | 'ADMIN_SETTINGS_BACKUP_ERROR'
  | 'ADMIN_SETTINGS_RESTORED'
  | 'ADMIN_SETTINGS_RESTORE_ERROR'
  | 'ADMIN_SETTINGS_RESET_TO_DEFAULTS'
  | 'ADMIN_SETTINGS_RESET_ERROR'
  | 'ADMIN_AUTH_ERROR'
  | 'ADMIN_PERMISSION_DENIED'
  | 'ADMIN_INVALID_REQUEST'
  | 'ADMIN_DATABASE_ERROR'
  | 'ADMIN_EXPORT_ERROR'

  // 회원 관리 이벤트
  | 'MEMBER_REGISTRATION_BLOCKED'
  | 'MEMBER_APPROVAL_FAILED'
  | 'MEMBER_STATUS_CHANGE_FAILED'
  | 'MEMBER_PROFILE_UPDATE_BLOCKED'
  | 'MEMBER_DELETION_BLOCKED'
  | 'INVALID_MEMBER_ACTION'
  | 'MEMBER_STATUS_CHANGED'
  | 'INVALID_MEMBER_SEARCH'

  // 대량 작업 이벤트
  | 'INVALID_BULK_OPERATION'
  | 'BULK_OPERATION_COMPLETED'
  | 'BULK_OPERATION_ERROR'

  // 지원사업 다이제스트 이벤트 (단계 4 Task 7 — 관리자 발행)
  | 'GRANT_DIGEST_PUBLISHED'

  // 검색 이벤트
  | 'SEARCH_QUERY_BLOCKED'
  | 'SEARCH_INJECTION_ATTEMPT'
  | 'SEARCH_RATE_LIMIT_EXCEEDED'
  | 'INVALID_SEARCH_QUERY'

  // 설정 관리 이벤트
  | 'SETTINGS_UPDATE_BLOCKED'
  | 'SETTINGS_VALIDATION_FAILED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATION_ERROR'

  // 파일 검증 관련 보안 이벤트
  | 'DANGEROUS_FILE_EXTENSION'
  | 'SUSPICIOUS_IMAGE_URL'
  | 'DANGEROUS_QUERY_PARAM'
  | 'IMAGE_WHITELIST_UPDATED'
  | 'IMAGE_BLACKLIST_UPDATED'
  | 'XSS_ATTEMPT_IN_EMAIL'
  | 'SQL_INJECTION_ATTEMPT'
  | 'MALICIOUS_PHONE_NUMBER'
  | 'MALICIOUS_USERNAME'
  | 'XSS_ATTEMPT_IN_TITLE'
  | 'XSS_ATTEMPT_IN_CONTENT'
  | 'MALICIOUS_URL'
  | 'MALICIOUS_FILENAME'
  | 'SQL_INJECTION_IN_SEARCH'
  | 'XSS_IN_SEARCH'

export type SecurityEventSeverity = 'low' | 'medium' | 'high'

export interface SecurityEventContext {
  readonly [key: string]: unknown
  readonly timestamp?: string
  readonly userAgent?: string
  readonly clientIP?: string
}

export interface CSPViolationReport {
  readonly 'document-uri': string
  readonly referrer: string
  readonly 'violated-directive': string
  readonly 'effective-directive': string
  readonly 'original-policy': string
  readonly disposition: string
  readonly 'blocked-uri': string
  readonly 'line-number'?: number
  readonly 'column-number'?: number
  readonly 'source-file'?: string
}

export interface CSPReportWrapper {
  readonly 'csp-report': CSPViolationReport
}

export interface TempFileCleanupResult {
  readonly message: string
  readonly cleaned: number
  readonly files: readonly {
    readonly id: string
    readonly fileName: string
  }[]
}

export interface TempFileCleanupStats {
  readonly total: number
  readonly active: number
  readonly expired: number
  readonly totalSize: number
  readonly expiredSize: number
  readonly expiredSizeMB: number
}
