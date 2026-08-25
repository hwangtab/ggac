import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { createLogger, maskId } from '@/utils/logger'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { listSystemSettings, updateSystemSetting } from '@/db/queries/settings'

const log = createLogger('admin/settings/backup')

const BackupSettingSchema = z.object({
  category: z.string().min(1).max(64),
  setting_key: z.string().min(1).max(128),
  setting_value: z.unknown(),
})

const RestoreBodySchema = z.object({
  metadata: z
    .object({
      version: z.string(),
      created_at: z.string().optional(),
      created_by: z.string().optional(),
      description: z.string().optional(),
    })
    .passthrough(),
  settings: z.array(BackupSettingSchema).min(1, '복원할 설정이 비어 있습니다.'),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 설정 백업 파일 생성 및 다운로드
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/settings/backup',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_backup'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  errorResponse: error => {
    log.error('Admin settings backup error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_BACKUP_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'high'
    )

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return isPermissionError
      ? ApiError.forbidden('관리자 권한이 필요합니다.').toNextResponse()
      : ApiError.internalServerError('설정 백업 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ auth }) => {
    const { user } = auth

    // 모든 시스템 설정 조회(민감한 정보 포함 — 아래에서 이 라우트 자체가
    // is_sensitive 기준으로 무조건 REDACTED 처리하므로 queries 계층의
    // 마스킹 여부와 무관하게 최종 출력은 동일하다).
    let settingsData: Awaited<ReturnType<typeof listSystemSettings>>
    try {
      settingsData = await listSystemSettings(true)
    } catch (error) {
      log.warn('Settings backup query failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      throw new Error('설정 백업 중 오류가 발생했습니다.')
    }

    // 민감한 설정값 마스킹 (SMTP 비밀번호, API 키 등)
    const sanitizedSettings = settingsData.map(s => ({
      ...s,
      setting_value: s.is_sensitive ? '***REDACTED***' : s.setting_value,
    }))

    // 백업 파일 생성
    const backupData = {
      metadata: {
        created_at: new Date().toISOString(),
        created_by: user.id,
        version: '1.0',
        description: '시스템 설정 백업 파일 (민감한 값은 제외됨)',
      },
      settings: sanitizedSettings,
    }

    // 보안 이벤트 로깅 — adminId 평문 노출 회피 (PII 마스킹)
    logSecurityEvent(
      'ADMIN_SETTINGS_BACKUP_CREATED',
      {
        adminId: maskId(user.id),
        settingsCount: settingsData?.length || 0,
      },
      'medium'
    )

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="ggac-settings-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  },
})

// POST: 백업 파일에서 설정 복원
export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/settings/backup',
  rateLimit: {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    keyGenerator: createUserKeyGenerator('admin_settings_restore'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: error => {
    console.error('Admin settings restore error:', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_RESTORE_ERROR',
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
          : '설정 복원 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async ({ body, auth }) => {
    const { user } = auth

    const parsed = RestoreBodySchema.safeParse(body)
    if (!parsed.success) {
      throw ApiError.badRequest('유효하지 않은 백업 파일입니다.')
    }
    const { settings: backupSettings, metadata } = parsed.data

    // 백업 파일 메타데이터 검증
    if (metadata.version !== '1.0') {
      throw ApiError.badRequest('지원하지 않는 백업 파일 버전입니다.')
    }

    // 설정 복원 실행
    const restoreResults: string[] = []
    const errorResults: string[] = []

    for (const setting of backupSettings) {
      try {
        const { category, setting_key, setting_value } = setting

        // 설정 유효성 검사
        if (!category || !setting_key || !setting_value) {
          errorResults.push(`${category}.${setting_key} (Invalid data)`)
          continue
        }

        // 마스킹된 민감 데이터는 복원하지 않음 (원본 값 보존)
        if (setting_value === '***REDACTED***') {
          continue
        }

        // 데이터베이스 업데이트
        try {
          await updateSystemSetting({
            category: category as 'site' | 'email' | 'security' | 'features',
            settingKey: setting_key,
            settingValue: setting_value,
            actorId: user.id,
          })
          restoreResults.push(`${category}.${setting_key}`)
        } catch (updateError) {
          console.error(`Setting restore error for ${category}.${setting_key}:`, updateError)
          errorResults.push(`${category}.${setting_key}`)
        }
      } catch (err) {
        console.error(`Setting restore exception:`, err)
        errorResults.push(`${setting.category || 'unknown'}.${setting.setting_key || 'unknown'}`)
      }
    }

    // 설정이 하나라도 복원되었다면 캐시 무효화 — 다음 조회부터 새 값이 반영되도록 한다.
    if (restoreResults.length > 0) {
      refreshSettingsCache()
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_RESTORED',
      {
        adminId: user.id,
        restored: restoreResults,
        errors: errorResults,
        backupMetadata: metadata,
      },
      'high'
    ) // 복원은 높은 보안 등급

    return ApiSuccess.ok(
      {
        restored: restoreResults,
        errors: errorResults,
        backupInfo: metadata,
      },
      errorResults.length === 0
        ? '설정이 성공적으로 복원되었습니다.'
        : `일부 설정 복원에 실패했습니다. 성공: ${restoreResults.length}, 실패: ${errorResults.length}`
    )
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
