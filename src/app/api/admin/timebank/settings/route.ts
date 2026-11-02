/**
 * 타임뱅크 설정(스펙 §9.1·§9.2, 계획 Task 9). 이사회가 의결한 이용규칙의 수치와
 * 스위치라 **이 라우트로만** 바뀐다 — 일반 설정 PUT(`.strict()`)·초기화·백업 복원은
 * `timebank_features`를 건드리지 않는다.
 *
 * - GET: 현재 값(정규화)과 변경 이력(의결 근거 포함, 최근 20건).
 * - PUT 본문 `{ settings: Partial<TimebankSettings>, resolution_ref }`:
 *   `planTimebankSettingsChange`가 의결 근거(5~200자)·모르는 칸·범위 밖 값(조용히
 *   기본값으로 떨어뜨리지 않고 400)·"수치를 바꾸면 이용규칙 판도 올려야 한다"를
 *   본다. 통과하면 `updateSystemSetting({ changeReason: resolution_ref })`가
 *   `system_settings_history`에 근거를 남긴다. 이 인스턴스의 설정 캐시를 비운다.
 *   설정 행이 없으면(시드 전) 409. 읽은 뒤 다른 관리자가 먼저 바꿨으면(`updated_at`
 *   불일치) 쓰지 않고 409.
 *
 * 활동 `timebank_settings_changed` + 보안 로그(high).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { auditTimebankAdminWrite, timebankAdminErrorResponse } from '@/lib/server/timebankAdmin'
import { planTimebankSettingsChange } from '@/lib/timebank/adminRules'
import { normalizeTimebankSettings } from '@/lib/timebank/settings'
import { refreshSettingsCache } from '@/utils/systemSettings'
import {
  SettingNotFoundError,
  getSystemSettingRow,
  listSystemSettingHistory,
  updateSystemSetting,
} from '@/db/queries/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SETTING_KEY = 'timebank_features'
const STALE_MESSAGE = '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침 후 다시 시도해 주세요.'
const NO_ROW_MESSAGE =
  '타임뱅크 설정 행이 없습니다. 시드 스크립트(scripts/turso/seed-timebank-settings.mjs)를 먼저 실행해 주세요.'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/timebank/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_settings'),
  },
  auth: 'admin',
  errorResponse: timebankAdminErrorResponse('settings', '타임뱅크 설정을 불러오지 못했습니다.'),
  handler: async () => {
    // 캐시를 거치지 않고 표에서 바로 읽는다 — 방금 바꾼 값이 화면에 그대로 보여야 한다.
    const [row, history] = await Promise.all([
      getSystemSettingRow('features', SETTING_KEY),
      listSystemSettingHistory(SETTING_KEY, 20),
    ])
    return ApiSuccess.ok({
      settings: normalizeTimebankSettings(row?.setting_value),
      has_row: Boolean(row),
      history,
    })
  },
})

export const PUT = defineApiRoute<Record<string, unknown>, AdminAuthSuccess>({
  method: 'PUT',
  name: 'api/admin/timebank/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_settings'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: timebankAdminErrorResponse('settings', '타임뱅크 설정을 바꾸지 못했습니다.'),
  handler: async ({ request, body, auth }) => {
    const row = await getSystemSettingRow('features', SETTING_KEY)
    const plan = planTimebankSettingsChange({ current: row?.setting_value, body })
    if (plan.ok === false) throw ApiError.badRequest(plan.message)
    if (!row) throw ApiError.conflict(NO_ROW_MESSAGE)

    const before = normalizeTimebankSettings(row.setting_value)
    // 읽은 행의 updated_at으로 조건부로 쓴다 — 읽기·병합·쓰기 사이에 다른 관리자가
    // 먼저 썼으면 그 값을 덮어쓰지 않고 409로 돌려보낸다(lost update 방지).
    let result: Awaited<ReturnType<typeof updateSystemSetting>>
    try {
      result = await updateSystemSetting({
        category: 'features',
        settingKey: SETTING_KEY,
        settingValue: plan.next,
        actorId: auth.user.id,
        changeReason: plan.resolution_ref,
        expectedUpdatedAt: row.updated_at,
      })
    } catch (error) {
      if (error instanceof SettingNotFoundError) throw ApiError.conflict(NO_ROW_MESSAGE)
      throw error
    }
    if (result.outcome === 'stale') throw ApiError.conflict(STALE_MESSAGE)
    refreshSettingsCache()

    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_settings_changed',
      target_type: 'system',
      target_id: null,
      metadata: {
        setting_key: SETTING_KEY,
        resolution_ref: plan.resolution_ref,
        changed: plan.changed,
        before: Object.fromEntries(plan.changed.map(k => [k, before[k]])),
        after: Object.fromEntries(plan.changed.map(k => [k, plan.next[k]])),
      },
    })

    return ApiSuccess.ok(
      { settings: plan.next, changed: plan.changed },
      '타임뱅크 설정을 바꿨습니다. 다른 서버 인스턴스에는 설정 캐시가 끝나는 대로 반영됩니다.'
    )
  },
})
