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
import { clampFeeRateBp, MEMBER_FEE_RATE_BP, NONMEMBER_FEE_RATE_BP } from '../funding/feeRate.ts'

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
    // 없을 때의 기본값은 **취향이 아니라 소비처가 정한다.** 이 칸을 읽는
    // 소비처는 이제 하나다 — `@/lib/auth/emailVerificationGate`의
    // `isEmailVerificationEnforced()`이고, 그쪽은 `enforce_on_login === true`
    // 일 때만 켜짐으로 읽는다. 화면도 정확히 같은 판정을 한다.
    //
    // **옛 `required` 칸을 읽지 않는다.** 운영 행에는 아무도 읽지 않는
    // `required: true`가 남아 있어서, 그 칸을 읽으면 관문을 붙이는 순간
    // 화면이 "켜짐"으로 뜨고 미인증 회원이 문 앞에서 막힌다. 새 칸은 운영
    // 행에 없으므로 배포 직후 값은 꺼짐이다(관문 모듈의 파일 첫머리 참고).
    require_email_verification: {
      key: 'email_verification',
      transform: (value: any) => value?.enforce_on_login === true,
    },
  },
  features: {
    // 이 넷의 "값이 없을 때"는 `@/utils/systemSettings`의 `isFeatureEnabled()`가
    // `?? true`로 정해 둔다(같은 모듈의 `getDefaultSettings()`도 전부 `true`).
    // 그 판정을 그대로 따른다 — 없으면 켜진 것, 저장된 `false`는 꺼진 것.
    board_enabled: { key: 'board_features', transform: (value: any) => value?.enabled ?? true },
    artist_registration_enabled: {
      key: 'artist_features',
      transform: (value: any) => value?.registration_enabled ?? true,
    },
    comments_enabled: {
      key: 'comment_features',
      transform: (value: any) => value?.enabled ?? true,
    },
    file_uploads_enabled: { key: 'file_upload', transform: (value: any) => value?.enabled ?? true },
    // 펀딩은 켜면 돈이 움직인다 — 다른 기능들과 달리 값이 없을 때 켜진 쪽으로
    // 기울면 안 된다. 소비처(`@/lib/funding/settings`의 normalizeFundingSettings)도
    // `enabled === true`만 켜짐으로 읽는다.
    funding_enabled: {
      key: 'funding_features',
      transform: (value: any) => value?.enabled === true,
    },
    // 두 수수료율. 화면은 퍼센트로 보여 주지만 오가는 값은 저장 단위(bp)
    // 그대로다 — 퍼센트↔bp 변환은 `@/lib/funding/feeRate`의 두 함수가
    // 전담하고, 그 자리가 화면이다.
    //
    // 값이 없을 때의 기본값을 소비처(`normalizeFundingSettings`)와 똑같이
    // `clampFeeRateBp`로 낸다. 화면이 "0%"라고 적어 놓고 실제로는 3.3%를
    // 떼는 일이 없어야 한다 — 운영 행에는 아직 옛 키(`platform_fee_rate_bp`)
    // 하나만 있고 새 두 칸이 없으므로, 오늘 이 화면이 처음 뜰 때 읽히는 것이
    // 바로 이 기본값이다.
    funding_fee_rate_member_bp: {
      key: 'funding_features',
      transform: (value: any) =>
        clampFeeRateBp(value?.platform_fee_rate_member_bp, MEMBER_FEE_RATE_BP),
    },
    funding_fee_rate_nonmember_bp: {
      key: 'funding_features',
      transform: (value: any) =>
        clampFeeRateBp(value?.platform_fee_rate_nonmember_bp, NONMEMBER_FEE_RATE_BP),
    },
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

/**
 * PUT의 역변환 — 화면이 보낸 필드 하나로 그룹 JSON 전체를 다시 만든다.
 *
 * 이 네 그룹은 화면이 **한 필드만** 보내는데 저장은 그룹 통째로 한다. 그래서
 * 보내지 않은 형제 필드를 저장값(`seed`)에서 되살려야 하는데, 예전에는 그것을
 * `seed?.require_uppercase || true`로 적었다. 그 식은 저장된 `false`를 매번
 * `true`로 되돌린다 — 관리자가 끈 비밀번호 요건이 같은 그룹의 다른 항목을
 * 저장할 때마다 조용히 되살아났다. 값이 **없을 때만** 기본값을 쓰도록 `??`로
 * 바꾼다.
 *
 * 기본값 자체는 바꾸지 않았다. 이 네 그룹의 불리언(`require_*`)은 지금 어떤
 * 코드도 읽지 않으므로 "없을 때 어떻게 도는가"를 정하는 자리는
 * `@/utils/systemSettings`의 `getDefaultSettings()`와 `/api/admin/settings/reset`의
 * 기본값 표뿐이고, 둘 다 `true`다.
 *
 * 라우트가 아니라 이 파일에 두는 이유는 파일 첫머리의 설명과 같다 — 라우트는
 * `@/` 별칭 때문에 plain Node로 못 부르고, 그래서 이 결함이 테스트 없이 살아남았다.
 */
export function buildRegistrationEnabledValue(
  seed: Record<string, any>,
  enabled: unknown
): Record<string, any> {
  return {
    enabled,
    require_approval: seed?.require_approval ?? true,
  }
}

export function buildSessionConfigValue(
  seed: Record<string, any>,
  timeoutMinutes: unknown
): Record<string, any> {
  return {
    timeout_minutes: timeoutMinutes,
    max_concurrent_sessions: seed?.max_concurrent_sessions || 5,
    require_reauth_for_sensitive: seed?.require_reauth_for_sensitive ?? true,
  }
}

export function buildLoginPolicyValue(
  seed: Record<string, any>,
  maxAttempts: unknown
): Record<string, any> {
  return {
    max_attempts: maxAttempts,
    lockout_duration_minutes: seed?.lockout_duration_minutes || 30,
    require_strong_password: seed?.require_strong_password ?? true,
  }
}

export function buildPasswordPolicyValue(
  seed: Record<string, any>,
  minLength: unknown
): Record<string, any> {
  return {
    min_length: minLength,
    require_uppercase: seed?.require_uppercase ?? true,
    require_lowercase: seed?.require_lowercase ?? true,
    require_numbers: seed?.require_numbers ?? true,
    // `require_special`은 기본값이 `false`라 `||`로도 저장된 값을 뒤집지
    // 않았다(그래서 이번 열두 자리에 들어가지 않는다). 나머지와 같은 식으로
    // 적어 두면 다음 사람이 기본값만 보고 판단하지 않는다.
    require_special: seed?.require_special ?? false,
    history_count: seed?.history_count || 5,
  }
}

/**
 * 펀딩 그룹의 역변환. **이 그룹만 따로 두는 이유**는 칸이 셋이기 때문이다 —
 * 스위치 하나와 요율 둘. 다른 기능 그룹처럼 `{...seed, enabled: frontendValue}`
 * 한 줄로 처리하면 요율을 저장할 때 그 숫자가 `enabled` 칸에 들어앉아
 * 펀딩이 켜진 것으로 읽힌다(`330`은 truthy다). 켜면 돈이 움직이는 스위치다.
 *
 * 화면은 바뀐 칸만 보내므로(`diffSettings`) 보내지 않은 형제 칸은 저장값
 * (`seed`)에 그대로 남는다.
 */
export function applyFundingFeatureField(
  seed: Record<string, any>,
  frontendKey: string,
  frontendValue: unknown
): Record<string, any> {
  const next = { ...(seed ?? {}) }
  if (frontendKey === 'funding_enabled') {
    next.enabled = frontendValue
  } else if (frontendKey === 'funding_fee_rate_member_bp') {
    next.platform_fee_rate_member_bp = frontendValue
  } else if (frontendKey === 'funding_fee_rate_nonmember_bp') {
    next.platform_fee_rate_nonmember_bp = frontendValue
  }
  return next
}
