/**
 * 관리자 설정 유효성 검증 유틸리티
 * 클라이언트/서버 사이드에서 사용할 수 있는 설정 검증 함수들
 */

export interface ValidationError {
  field: string
  message: string
  category?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

/**
 * 이메일 주소 유효성 검증
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * 포트 번호 유효성 검증
 */
export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * URL 유효성 검증
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 전화번호 유효성 검증 (한국 형식)
 */
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^(\d{2,3}-\d{3,4}-\d{4}|\d{10,11})$/
  return phoneRegex.test(phone.replace(/\s/g, ''))
}

/**
 * 비밀번호 정책 유효성 검증
 */
export function validatePasswordPolicy(policy: {
  min_length: number
  require_uppercase: boolean
  require_lowercase: boolean
  require_numbers: boolean
  require_special: boolean
  history_count: number
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!Number.isInteger(policy.min_length) || policy.min_length < 4 || policy.min_length > 128) {
    errors.push({
      field: 'password_min_length',
      message: '최소 비밀번호 길이는 4-128자 사이여야 합니다.',
      category: 'security'
    })
  }

  if (!Number.isInteger(policy.history_count) || policy.history_count < 0 || policy.history_count > 50) {
    errors.push({
      field: 'password_history_count',
      message: '비밀번호 히스토리 개수는 0-50개 사이여야 합니다.',
      category: 'security'
    })
  }

  return errors
}

/**
 * 세션 설정 유효성 검증
 */
export function validateSessionConfig(config: {
  timeout_minutes: number
  max_concurrent_sessions: number
  require_reauth_for_sensitive: boolean
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!Number.isInteger(config.timeout_minutes) || config.timeout_minutes < 1 || config.timeout_minutes > 10080) { // 최대 1주일
    errors.push({
      field: 'session_timeout',
      message: '세션 타임아웃은 1분에서 1주일(10080분) 사이여야 합니다.',
      category: 'security'
    })
  }

  if (!Number.isInteger(config.max_concurrent_sessions) || config.max_concurrent_sessions < 1 || config.max_concurrent_sessions > 100) {
    errors.push({
      field: 'max_concurrent_sessions',
      message: '최대 동시 세션 수는 1-100개 사이여야 합니다.',
      category: 'security'
    })
  }

  return errors
}

/**
 * 로그인 정책 유효성 검증
 */
export function validateLoginPolicy(policy: {
  max_attempts: number
  lockout_duration_minutes: number
  require_strong_password: boolean
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!Number.isInteger(policy.max_attempts) || policy.max_attempts < 1 || policy.max_attempts > 100) {
    errors.push({
      field: 'max_login_attempts',
      message: '최대 로그인 시도 횟수는 1-100회 사이여야 합니다.',
      category: 'security'
    })
  }

  if (!Number.isInteger(policy.lockout_duration_minutes) || policy.lockout_duration_minutes < 1 || policy.lockout_duration_minutes > 1440) { // 최대 24시간
    errors.push({
      field: 'lockout_duration_minutes',
      message: '잠금 지속 시간은 1분에서 24시간(1440분) 사이여야 합니다.',
      category: 'security'
    })
  }

  return errors
}

/**
 * SMTP 설정 유효성 검증
 */
export function validateSmtpConfig(config: {
  host: string
  port: number
  user: string
  password: string
  from_email: string
  from_name: string
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (config.host && config.host.trim().length > 0) {
    // 호스트가 제공된 경우에만 검증
    if (config.host.length > 255) {
      errors.push({
        field: 'smtp_host',
        message: 'SMTP 호스트 이름이 너무 깁니다 (최대 255자).',
        category: 'email'
      })
    }

    if (!validatePort(config.port)) {
      errors.push({
        field: 'smtp_port',
        message: 'SMTP 포트는 1-65535 사이의 유효한 포트 번호여야 합니다.',
        category: 'email'
      })
    }

    if (config.user && config.user.length > 320) { // 이메일 최대 길이
      errors.push({
        field: 'smtp_user',
        message: 'SMTP 사용자명이 너무 깁니다 (최대 320자).',
        category: 'email'
      })
    }

    if (config.password && config.password.length > 1024) {
      errors.push({
        field: 'smtp_password',
        message: 'SMTP 비밀번호가 너무 깁니다 (최대 1024자).',
        category: 'email'
      })
    }
  }

  if (config.from_email && !validateEmail(config.from_email)) {
    errors.push({
      field: 'from_email',
      message: '발신자 이메일 주소가 유효하지 않습니다.',
      category: 'email'
    })
  }

  if (config.from_name && config.from_name.length > 100) {
    errors.push({
      field: 'from_name',
      message: '발신자 이름이 너무 깁니다 (최대 100자).',
      category: 'email'
    })
  }

  return errors
}

/**
 * 사이트 설정 유효성 검증
 */
export function validateSiteConfig(config: {
  site_title: string
  site_description: string
  max_members: number
  maintenance_mode: boolean
  registration_enabled: boolean
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!config.site_title || config.site_title.trim().length === 0) {
    errors.push({
      field: 'site_title',
      message: '사이트 제목은 필수입니다.',
      category: 'site'
    })
  } else if (config.site_title.length > 100) {
    errors.push({
      field: 'site_title',
      message: '사이트 제목이 너무 깁니다 (최대 100자).',
      category: 'site'
    })
  }

  if (config.site_description && config.site_description.length > 500) {
    errors.push({
      field: 'site_description',
      message: '사이트 설명이 너무 깁니다 (최대 500자).',
      category: 'site'
    })
  }

  if (!Number.isInteger(config.max_members) || config.max_members < 1 || config.max_members > 1000000) {
    errors.push({
      field: 'max_members',
      message: '최대 회원 수는 1-1,000,000명 사이여야 합니다.',
      category: 'site'
    })
  }

  return errors
}

/**
 * 파일 업로드 설정 유효성 검증
 */
export function validateFileUploadConfig(config: {
  enabled: boolean
  max_size_mb: number
  allowed_types: string[]
  virus_scan: boolean
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (config.enabled) {
    if (!Number.isInteger(config.max_size_mb) || config.max_size_mb < 1 || config.max_size_mb > 1024) { // 최대 1GB
      errors.push({
        field: 'max_file_size',
        message: '최대 파일 크기는 1MB-1024MB 사이여야 합니다.',
        category: 'features'
      })
    }

    if (!Array.isArray(config.allowed_types) || config.allowed_types.length === 0) {
      errors.push({
        field: 'allowed_file_types',
        message: '허용할 파일 형식을 최소 1개 이상 선택해야 합니다.',
        category: 'features'
      })
    } else {
      const validTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed'
      ]
      
      const invalidTypes = config.allowed_types.filter(type => !validTypes.includes(type))
      if (invalidTypes.length > 0) {
        errors.push({
          field: 'allowed_file_types',
          message: `지원하지 않는 파일 형식: ${invalidTypes.join(', ')}`,
          category: 'features'
        })
      }
    }
  }

  return errors
}

/**
 * 전체 설정 유효성 검증
 */
export function validateAllSettings(settings: any): ValidationResult {
  const allErrors: ValidationError[] = []

  // 사이트 설정 검증
  if (settings.site) {
    const siteErrors = validateSiteConfig({
      site_title: settings.site.site_title,
      site_description: settings.site.site_description,
      max_members: settings.site.max_members,
      maintenance_mode: settings.site.maintenance_mode,
      registration_enabled: settings.site.registration_enabled
    })
    allErrors.push(...siteErrors)
  }

  // 이메일 설정 검증
  if (settings.email) {
    const emailErrors = validateSmtpConfig({
      host: settings.email.smtp_host,
      port: settings.email.smtp_port,
      user: settings.email.smtp_user,
      password: settings.email.smtp_password,
      from_email: settings.email.from_email,
      from_name: settings.email.from_name
    })
    allErrors.push(...emailErrors)
  }

  // 보안 설정 검증
  if (settings.security) {
    const sessionErrors = validateSessionConfig({
      timeout_minutes: settings.security.session_timeout,
      max_concurrent_sessions: 5, // 기본값
      require_reauth_for_sensitive: true // 기본값
    })
    allErrors.push(...sessionErrors)

    const loginErrors = validateLoginPolicy({
      max_attempts: settings.security.max_login_attempts,
      lockout_duration_minutes: 30, // 기본값
      require_strong_password: true // 기본값
    })
    allErrors.push(...loginErrors)

    const passwordErrors = validatePasswordPolicy({
      min_length: settings.security.password_min_length,
      require_uppercase: true, // 기본값
      require_lowercase: true, // 기본값
      require_numbers: true, // 기본값
      require_special: false, // 기본값
      history_count: 5 // 기본값
    })
    allErrors.push(...passwordErrors)
  }

  // 기능 설정 검증
  if (settings.features && settings.features.file_uploads_enabled) {
    const fileErrors = validateFileUploadConfig({
      enabled: settings.features.file_uploads_enabled,
      max_size_mb: 10, // 기본값
      allowed_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], // 기본값
      virus_scan: false // 기본값
    })
    allErrors.push(...fileErrors)
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors
  }
}

/**
 * 실시간 필드 유효성 검증 (클라이언트용)
 */
export function validateField(category: string, field: string, value: any): ValidationError | null {
  switch (category) {
    case 'site':
      if (field === 'site_title' && (!value || value.trim().length === 0)) {
        return { field, message: '사이트 제목은 필수입니다.', category }
      }
      if (field === 'site_title' && value.length > 100) {
        return { field, message: '사이트 제목이 너무 깁니다 (최대 100자).', category }
      }
      if (field === 'max_members' && (!Number.isInteger(value) || value < 1 || value > 1000000)) {
        return { field, message: '최대 회원 수는 1-1,000,000명 사이여야 합니다.', category }
      }
      break

    case 'email':
      if (field === 'from_email' && value && !validateEmail(value)) {
        return { field, message: '유효한 이메일 주소를 입력해주세요.', category }
      }
      if (field === 'smtp_port' && value && !validatePort(value)) {
        return { field, message: '유효한 포트 번호(1-65535)를 입력해주세요.', category }
      }
      break

    case 'security':
      if (field === 'session_timeout' && (!Number.isInteger(value) || value < 1 || value > 10080)) {
        return { field, message: '세션 타임아웃은 1분-1주일(10080분) 사이여야 합니다.', category }
      }
      if (field === 'max_login_attempts' && (!Number.isInteger(value) || value < 1 || value > 100)) {
        return { field, message: '최대 로그인 시도 횟수는 1-100회 사이여야 합니다.', category }
      }
      if (field === 'password_min_length' && (!Number.isInteger(value) || value < 4 || value > 128)) {
        return { field, message: '최소 비밀번호 길이는 4-128자 사이여야 합니다.', category }
      }
      break
  }

  return null
}