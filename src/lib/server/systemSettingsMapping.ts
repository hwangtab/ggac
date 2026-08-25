/**
 * `system_settings` 행(카테고리 + `setting_key` + JSON `setting_value`)과
 * 관리자 화면이 쓰는 평평한 필드 이름 사이의 매핑, 그리고 그 매핑에 붙는
 * 순수 판정 두 개.
 *
 * `src/app/api/admin/settings/route.ts`에서 떼어낸 이유는 **테스트 가능성**이다.
 * 라우트 파일은 `@/` 별칭 임포트를 쓰므로 plain Node(`node --experimental-strip-types`)
 * 로 불러올 수 없다 — 그 안에 있는 한 최종 리뷰 B-3이 잡은 사고
 * ("마스킹된 값이 되돌아와 진짜 SMTP 설정을 덮어쓴다")를 실제로 재현해 막히는지
 * 확인할 방법이 없었다. 이 모듈은 상대 경로 임포트만 쓰므로
 * `scripts/testing/systemSettingsMapping.test.mjs`가 **실제 매핑 표**를 그대로
 * 불러 검증한다.
 *
 * 이 파일에는 DB 접근이 없다(순수 변환·판정만).
 */

import { maskSensitiveSystemSetting, type SystemSettingRow } from '../../db/queries/settings.ts'

export interface SettingMapping {
  key: string
  transform: (value: any) => any
}

// 설정 카테고리별 키 매핑
export const SETTING_MAPPINGS = {
  site: {
    maintenance_mode: {
      key: 'maintenance_mode',
      transform: (value: any) => value?.enabled || false,
    },
    registration_enabled: {
      key: 'registration_enabled',
      transform: (value: any) => value?.enabled || false,
    },
    site_title: {
      key: 'site_title',
      transform: (value: any) => value?.value || '경기아트콜렉티브',
    },
    site_description: {
      key: 'site_description',
      transform: (value: any) => value?.value || '서울 밖에서 시끄러워집니다',
    },
    max_members: { key: 'max_members', transform: (value: any) => value?.value || 1000 },
  },
  email: {
    smtp_host: { key: 'smtp_config', transform: (value: any) => value?.host || '' },
    smtp_port: { key: 'smtp_config', transform: (value: any) => value?.port || 587 },
    smtp_user: { key: 'smtp_config', transform: (value: any) => value?.user || '' },
    smtp_password: {
      key: 'smtp_config',
      transform: (value: any) => (value?.password ? '••••••••' : ''),
    },
    from_email: {
      key: 'smtp_config',
      transform: (value: any) => value?.from_email || 'noreply@ggac.kr',
    },
    from_name: {
      key: 'smtp_config',
      transform: (value: any) => value?.from_name || '경기아트콜렉티브',
    },
  },
  security: {
    session_timeout: {
      key: 'session_config',
      transform: (value: any) => value?.timeout_minutes || 60,
    },
    max_login_attempts: {
      key: 'login_policy',
      transform: (value: any) => value?.max_attempts || 5,
    },
    password_min_length: {
      key: 'password_policy',
      transform: (value: any) => value?.min_length || 8,
    },
    require_email_verification: {
      key: 'email_verification',
      transform: (value: any) => value?.required || true,
    },
  },
  features: {
    board_enabled: { key: 'board_features', transform: (value: any) => value?.enabled || true },
    artist_registration_enabled: {
      key: 'artist_features',
      transform: (value: any) => value?.registration_enabled || true,
    },
    comments_enabled: {
      key: 'comment_features',
      transform: (value: any) => value?.enabled || true,
    },
    file_uploads_enabled: { key: 'file_upload', transform: (value: any) => value?.enabled || true },
  },
}

/**
 * GET이 **지금** 이 필드에 대해 클라이언트로 내보내는 값.
 *
 * `listSystemSettings(false)` → `maskSensitiveSystemSetting(row, false)` →
 * `mapping.transform(...)`이라는 GET의 경로를 그대로 다시 밟는다. 한 곳에서
 * 계산하므로 GET이 무엇을 내보내는지와 PUT이 무엇을 "본 그대로"로 인정하는지가
 * 어긋날 수 없다.
 */
export function valueServedToClient(row: SystemSettingRow, mapping: SettingMapping): unknown {
  return mapping.transform(maskSensitiveSystemSetting(row, false).setting_value)
}

/**
 * 클라이언트가 보낸 값이 "화면이 본 그대로"인가 — 즉 변경이 아닌가.
 *
 * **민감 설정에만 적용한다.** GET은 `is_sensitive` 설정을 `{masked:true, ...}`로
 * 내려보내고, 그것이 위 transform을 지나면 화면에는 빈 문자열이나 기본값으로
 * 보인다. 관리자 화면은 `settings` 객체 **전체**를 PUT했기 때문에, 그 값들이
 * 그대로 돌아와 진짜 SMTP 설정을 덮어썼다 — 유지보수 모드 토글 한 번이면
 * 충분했다(최종 리뷰 B-3).
 *
 * 민감하지 않은 설정에는 적용하지 않는다: GET이 진짜 값을 주므로 같은 값이
 * 돌아와도 덮어써서 잃을 것이 없고, 여기서 걸러 내면 오히려 "같은 값으로
 * 되돌리기" 조작이 조용히 무시된다.
 */
export function isClientEchoOfServedValue(
  row: SystemSettingRow | undefined,
  mapping: SettingMapping,
  frontendValue: unknown
): boolean {
  if (!row?.is_sensitive) return false
  return frontendValue === valueServedToClient(row, mapping)
}

/**
 * 부분 갱신을 위한 씨앗. 한 `setting_value`(예: `smtp_config`)는 프런트엔드
 * 필드 여러 개가 공유하는 JSON 객체다 — `{}`에서 새로 쌓아 올리면 이번에 보내지
 * 않은 형제 필드가 통째로 사라진다. 저장된 객체를 얕게 복제해 씨앗으로 준다
 * (원본을 그대로 넘기면 호출부의 필드 대입이 조회 결과를 변형한다).
 *
 * 객체가 아닌 저장값(null·배열·스칼라)은 병합 대상이 아니므로 빈 객체로 시작한다.
 */
export function seedSettingGroup(storedValue: unknown): Record<string, any> {
  if (storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue)) {
    return { ...(storedValue as Record<string, any>) }
  }
  return {}
}
