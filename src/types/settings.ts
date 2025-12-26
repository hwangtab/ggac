/**
 * 사용자 설정 시스템 타입 정의
 */

/**
 * 설정 카테고리
 */
export type SettingCategory =
  | 'notification' // 알림 설정
  | 'privacy' // 개인정보 설정
  | 'interface' // 인터페이스 설정
  | 'security' // 보안 설정
  | 'preference' // 개인 취향 설정

/**
 * 사용자 설정 인터페이스
 */
export interface UserSetting {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 설정 값 (JSON) */
  setting_value: Record<string, any>
  /** 생성 시간 */
  created_at: string
  /** 수정 시간 */
  updated_at: string
}

/**
 * 기본 설정값 템플릿 인터페이스
 */
export interface DefaultSetting {
  /** 고유 식별자 */
  id: string
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 기본값 (JSON) */
  default_value: Record<string, any>
  /** 설정 설명 */
  description: string | null
  /** 필수 설정 여부 */
  is_required: boolean
  /** 생성 시간 */
  created_at: string
}

/**
 * 설정 조회 결과 인터페이스
 */
export interface SettingWithDefault {
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 설정 값 (사용자 설정 또는 기본값) */
  setting_value: Record<string, any>
  /** 기본값 사용 여부 */
  is_default: boolean
  /** 설정 설명 */
  description: string | null
}

/**
 * 설정 업데이트 요청 인터페이스
 */
export interface SettingUpdateRequest {
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 새로운 설정 값 */
  setting_value: Record<string, any>
}

/**
 * 일괄 설정 업데이트 결과 인터페이스
 */
export interface BulkSettingUpdateResult {
  /** 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 성공 여부 */
  success: boolean
  /** 설정 ID (성공 시) */
  setting_id?: string
  /** 오류 메시지 (실패 시) */
  error?: string
}
