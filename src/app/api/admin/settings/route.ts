import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { createLogger } from '@/utils/logger'
import { listSystemSettings, updateSystemSetting } from '@/db/queries/settings'
import {
  SETTING_MAPPINGS,
  isClientEchoOfServedValue,
  seedSettingGroup,
  type SettingMapping,
} from '@/lib/server/systemSettingsMapping'

const log = createLogger('admin/settings')

// PUT 요청 본문 스키마 (모든 카테고리/필드는 optional, 일부 업데이트 허용)
const SystemSettingsUpdateSchema = z
  .object({
    site: z
      .object({
        maintenance_mode: z.boolean().optional(),
        registration_enabled: z.boolean().optional(),
        site_title: z.string().min(1).max(200).optional(),
        site_description: z.string().max(500).optional(),
        max_members: z.number().int().min(1).max(1_000_000).optional(),
      })
      .partial()
      .optional(),
    email: z
      .object({
        smtp_host: z.string().max(255).optional(),
        smtp_port: z.number().int().min(1).max(65535).optional(),
        smtp_user: z.string().max(255).optional(),
        smtp_password: z.string().max(255).optional(),
        from_email: z.string().email().or(z.string().length(0)).optional(),
        from_name: z.string().max(100).optional(),
      })
      .partial()
      .optional(),
    security: z
      .object({
        session_timeout: z.number().int().min(1).max(10080).optional(),
        max_login_attempts: z.number().int().min(1).max(100).optional(),
        password_min_length: z.number().int().min(4).max(64).optional(),
        require_email_verification: z.boolean().optional(),
      })
      .partial()
      .optional(),
    features: z
      .object({
        board_enabled: z.boolean().optional(),
        artist_registration_enabled: z.boolean().optional(),
        comments_enabled: z.boolean().optional(),
        file_uploads_enabled: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .strict()

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface SystemSettings {
  site: {
    maintenance_mode: boolean
    registration_enabled: boolean
    site_title: string
    site_description: string
    max_members: number
  }
  email: {
    smtp_host: string
    smtp_port: number
    smtp_user: string
    smtp_password: string
    from_email: string
    from_name: string
  }
  security: {
    session_timeout: number
    max_login_attempts: number
    password_min_length: number
    require_email_verification: boolean
  }
  features: {
    board_enabled: boolean
    artist_registration_enabled: boolean
    comments_enabled: boolean
    file_uploads_enabled: boolean
  }
}

// GET: 관리자 설정 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_get'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  errorResponse: error => {
    log.error('Admin settings GET error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_ACCESS_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'medium'
    )

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '설정 조회 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async () => {
    // get_system_settings RPC 대체 — src/db/queries/settings.ts의
    // listSystemSettings 참고. `includeSensitive: false`로 부른다: 이 라우트는
    // 이미 `requireSettingsAdmin()`을 통과한 뒤라 원칙적으로는 마스킹을 풀어도
    // 되지만, 관리자 브라우저에까지 SMTP 비밀번호 평문을 내려보낼 이유가 없다.
    //
    // ⚠ 정정(최종 리뷰 B-3): 예전 이 자리의 주석은 "옛 RPC도 어차피 마스킹된
    // 값을 줬으니 동작이 같다"고 적었는데 **사실이 아니다.** 옛 라우트는
    // service-role 클라이언트라 RPC 호출 자체가 예외로 떨어졌고, 그때
    // 마스킹 없는 직접 select로 폴백해 **평문**을 내려보내고 있었다. 즉
    // 마스킹은 이 전환이 처음 들여온 동작이다. 그 차이가 실제 사고를 만든다 —
    // 화면은 `settings` 객체 **전체**를 PUT하므로, 마스킹된 값을 그대로 받은
    // 화면에서 유지보수 모드 토글 한 번만 눌러도 `smtp_config`가 빈 값으로
    // 덮였다. 그래서 PUT 쪽에 "클라이언트가 본 그대로 돌려준 민감 필드는
    // 변경으로 취급하지 않는다"는 방어를 넣었다(아래 PUT 핸들러 참고).
    let settingsData: Awaited<ReturnType<typeof listSystemSettings>>
    try {
      settingsData = await listSystemSettings(false)
    } catch (error) {
      log.error('Settings query error', error)
      throw new Error('설정을 조회할 수 없습니다.')
    }

    // 데이터베이스 결과를 프론트엔드 형식으로 변환
    const settings: SystemSettings = {
      site: {},
      email: {},
      security: {},
      features: {},
    } as SystemSettings

    // 설정 데이터를 카테고리별로 구조화
    for (const row of settingsData || []) {
      const category = row.category
      const settingKey = row.setting_key
      const settingValue = row.setting_value

      if (!settings[category as keyof SystemSettings]) {
        continue
      }

      // 매핑을 통해 프론트엔드 키로 변환
      const categoryMappings = SETTING_MAPPINGS[category as keyof typeof SETTING_MAPPINGS]
      if (categoryMappings) {
        for (const [frontendKey, mapping] of Object.entries(categoryMappings)) {
          if (mapping.key === settingKey) {
            ;(settings[category as keyof SystemSettings] as any)[frontendKey] =
              mapping.transform(settingValue)
          }
        }
      }
    }

    return ApiSuccess.ok(settings)
  },
})

// PUT: 관리자 설정 업데이트
export const PUT = defineApiRoute<Record<string, unknown>>({
  method: 'PUT',
  name: 'api/admin/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_update'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: error => {
    log.error('Admin settings PUT error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATE_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'high'
    )

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '설정 업데이트 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async ({ body, auth }) => {
    const { user } = auth

    const parsed = SystemSettingsUpdateSchema.safeParse(body)
    if (!parsed.success) {
      throw ApiError.badRequest('유효하지 않은 설정 데이터입니다.')
    }
    const requestData: z.infer<typeof SystemSettingsUpdateSchema> = parsed.data

    // 현재 저장값(평문)을 한 번만 읽어 둔다. 두 가지에 쓴다(최종 리뷰 B-3):
    //
    //  ① **부분 갱신 병합.** 한 `setting_value`(예: `smtp_config`)는 프런트엔드
    //     필드 여러 개가 공유하는 JSON 객체다. 예전에는 그 객체를 매번 `{}`에서
    //     새로 쌓아 올려서, 필드 하나만 보내도 나머지 형제 필드가 통째로
    //     사라졌다(같은 이유로 `max_members.current_count`도 매번 0으로 리셋됐다).
    //     저장값을 씨앗으로 두면 보내지 않은 필드는 그대로 남는다.
    //
    //  ② **마스킹된 값의 되쓰기 차단.** GET은 `is_sensitive` 설정을
    //     `{masked:true, ...}`로 내려보내고, 그것이 SETTING_MAPPINGS의 transform을
    //     지나면 화면에는 빈 문자열·기본값으로 보인다. 화면은 `settings` 객체
    //     **전체**를 PUT하므로, 그 값들이 그대로 돌아와 진짜 SMTP 설정을 덮어썼다
    //     — 유지보수 모드 토글 한 번이면 충분했다. 서버는 "지금 GET이 무엇을
    //     내보내는지"를 알고 있으므로, 민감 설정에 한해 **클라이언트가 본 그대로
    //     돌려준 필드는 변경으로 취급하지 않는다.** 관리자가 실제로 새 값을
    //     입력하면 본 값과 달라지므로 그대로 저장된다.
    let currentSettingRows: Awaited<ReturnType<typeof listSystemSettings>>
    try {
      currentSettingRows = await listSystemSettings(true)
    } catch (error) {
      log.error('Settings query error (PUT precondition)', error)
      throw new Error('설정을 조회할 수 없습니다.')
    }
    const currentSettingByKey = new Map(
      currentSettingRows.map(row => [`${row.category}.${row.setting_key}`, row])
    )

    // 설정별로 데이터베이스 업데이트
    const updateResults: string[] = []
    const errorResults: string[] = []
    const ignoredMaskedFields: string[] = []

    for (const [category, categoryData] of Object.entries(requestData)) {
      if (!categoryData || typeof categoryData !== 'object') {
        continue
      }

      const categoryMappings = SETTING_MAPPINGS[category as keyof typeof SETTING_MAPPINGS]
      if (!categoryMappings) {
        continue
      }

      // 같은 설정 키를 사용하는 항목들을 그룹화
      const settingGroups: { [key: string]: any } = {}

      for (const [frontendKey, frontendValue] of Object.entries(categoryData)) {
        const mapping = categoryMappings[frontendKey as keyof typeof categoryMappings] as
          | SettingMapping
          | undefined
        if (!mapping) {
          continue
        }

        const currentRow = currentSettingByKey.get(`${category}.${mapping.key}`)

        // ② 마스킹된 값의 되쓰기 차단(위 설명 참고). 판정과 근거는
        // `@/lib/server/systemSettingsMapping`에 있고, 그 파일을
        // `scripts/testing/systemSettingsMapping.test.mjs`가 실제 매핑 표로
        // 검증한다(라우트 파일은 `@/` 별칭 때문에 plain Node로 못 부른다).
        if (isClientEchoOfServedValue(currentRow, mapping, frontendValue)) {
          ignoredMaskedFields.push(`${category}.${frontendKey}`)
          continue
        }

        if (!settingGroups[mapping.key]) {
          // ① 부분 갱신 병합(위 설명 참고). 저장된 JSON 객체를 씨앗으로 둔다.
          settingGroups[mapping.key] = seedSettingGroup(currentRow?.setting_value)
        }

        // 역변환: 프론트엔드 값을 데이터베이스 형식으로 변환
        switch (mapping.key) {
          case 'maintenance_mode':
            settingGroups[mapping.key] = {
              enabled: frontendValue,
              message:
                settingGroups[mapping.key]?.message ||
                '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.',
            }
            break
          case 'registration_enabled':
            settingGroups[mapping.key] = {
              enabled: frontendValue,
              require_approval: settingGroups[mapping.key]?.require_approval || true,
            }
            break
          case 'site_title':
          case 'site_description':
            settingGroups[mapping.key] = { value: frontendValue }
            break
          case 'max_members':
            settingGroups[mapping.key] = {
              value: frontendValue,
              current_count: settingGroups[mapping.key]?.current_count || 0,
            }
            break
          case 'smtp_config':
            if (frontendKey === 'smtp_host') settingGroups[mapping.key].host = frontendValue
            else if (frontendKey === 'smtp_port') settingGroups[mapping.key].port = frontendValue
            else if (frontendKey === 'smtp_user') settingGroups[mapping.key].user = frontendValue
            else if (frontendKey === 'smtp_password')
              settingGroups[mapping.key].password = frontendValue
            else if (frontendKey === 'from_email')
              settingGroups[mapping.key].from_email = frontendValue
            else if (frontendKey === 'from_name')
              settingGroups[mapping.key].from_name = frontendValue
            break
          case 'session_config':
            if (frontendKey === 'session_timeout') {
              settingGroups[mapping.key] = {
                timeout_minutes: frontendValue,
                max_concurrent_sessions: settingGroups[mapping.key]?.max_concurrent_sessions || 5,
                require_reauth_for_sensitive:
                  settingGroups[mapping.key]?.require_reauth_for_sensitive || true,
              }
            }
            break
          case 'login_policy':
            if (frontendKey === 'max_login_attempts') {
              settingGroups[mapping.key] = {
                max_attempts: frontendValue,
                lockout_duration_minutes:
                  settingGroups[mapping.key]?.lockout_duration_minutes || 30,
                require_strong_password:
                  settingGroups[mapping.key]?.require_strong_password || true,
              }
            }
            break
          case 'password_policy':
            if (frontendKey === 'password_min_length') {
              settingGroups[mapping.key] = {
                min_length: frontendValue,
                require_uppercase: settingGroups[mapping.key]?.require_uppercase || true,
                require_lowercase: settingGroups[mapping.key]?.require_lowercase || true,
                require_numbers: settingGroups[mapping.key]?.require_numbers || true,
                require_special: settingGroups[mapping.key]?.require_special || false,
                history_count: settingGroups[mapping.key]?.history_count || 5,
              }
            }
            break
          case 'email_verification':
            if (frontendKey === 'require_email_verification') {
              settingGroups[mapping.key] = {
                required: frontendValue,
                token_expiry_hours: settingGroups[mapping.key]?.token_expiry_hours || 24,
                resend_limit: settingGroups[mapping.key]?.resend_limit || 3,
              }
            }
            break
          case 'board_features':
          case 'artist_features':
          case 'comment_features':
          case 'file_upload':
            settingGroups[mapping.key] = {
              ...settingGroups[mapping.key],
              enabled: frontendValue,
            }
            if (
              mapping.key === 'artist_features' &&
              frontendKey === 'artist_registration_enabled'
            ) {
              settingGroups[mapping.key].registration_enabled = frontendValue
            }
            break
        }
      }

      // 그룹화된 설정들을 데이터베이스에 업데이트
      for (const [settingKey, settingValue] of Object.entries(settingGroups)) {
        try {
          await updateSystemSetting({
            category: category as 'site' | 'email' | 'security' | 'features',
            settingKey,
            settingValue,
            actorId: user.id,
          })
          updateResults.push(`${category}.${settingKey}`)
        } catch (updateError) {
          log.error(`Setting update error for ${category}.${settingKey}`, updateError)
          errorResults.push(`${category}.${settingKey}`)
        }
      }
    }

    // 설정 업데이트 성공 시 캐시 무효화
    if (updateResults.length > 0) {
      refreshSettingsCache()
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATED',
      {
        adminId: user.id,
        updated: updateResults,
        errors: errorResults,
        // 화면이 마스킹된 값을 그대로 돌려보내 무시한 필드. 값은 담지 않는다
        // (필드 이름만). 조용히 버리면 "저장했는데 안 바뀐다"의 원인을 못 찾는다.
        ignoredMaskedFields,
      },
      'medium'
    )

    return ApiSuccess.ok(
      {
        updated: updateResults,
        errors: errorResults,
      },
      errorResults.length === 0
        ? '설정이 성공적으로 업데이트되었습니다.'
        : `일부 설정 업데이트에 실패했습니다. 성공: ${updateResults.length}, 실패: ${errorResults.length}`
    )
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
