/**
 * `system_settings`/`user_settings`/`default_settings`/`system_settings_history`
 * 쿼리 계층 (Turso/Drizzle). 단계 4 Task 4.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인 여부,
 * 관리자 여부)은 호출부(라우트의 `requireUser()`·`requireSettingsAdmin()`
 * 등)의 몫이고, 이 모듈의 모든 함수는 **이미 검증된 인자만** 받는다.
 *
 * 응답 형태는 snake_case다 — `src/db/queries/activities.ts`·`notifications.ts`와
 * 같은 이유(CLAUDE.md, strict: false라 키가 바뀌어도 타입 검사가 못 잡고
 * 화면이 조용히 빈다).
 *
 * ## `get_user_settings` RPC 대체 — `getUserSettings`
 *
 * 원본(20250719090070_create_user_settings.sql)은
 * `target_user_id := COALESCE(p_user_id, auth.uid())`였지만, 유일한 호출부
 * (`src/app/api/settings/route.ts`)는 항상 `p_user_id`를 명시해서 불렀다 —
 * 이 함수는 그 형태를 그대로 유지해 `userId`를 필수 인자로 받는다(브리프
 * 지시: "그 형태를 유지해라"). `default_settings LEFT JOIN user_settings`
 * (사용자·카테고리·키로 스코프)를 그대로 옮겼고, `is_default`는 원본의
 * `(us.id IS NULL)`과 동일하게 사용자 오버라이드 행이 없을 때만 true다.
 * 정렬도 원본의 `ORDER BY ds.category, ds.setting_key`를 그대로 따른다.
 *
 * ## `system_settings` 트리거 2종 재현 — `updateSystemSetting`
 *
 * Postgres 원본에는 BEFORE UPDATE 트리거(`update_system_settings_updated_at`)와
 * AFTER UPDATE 트리거(`log_system_settings_change`)가 걸려 있었다. 단계
 * 2c에서 이미 `update_system_settings_updated_at`을
 * `NEW.updated_by = COALESCE(NEW.updated_by, auth.uid())`로 교정했고
 * (20260824040000), 서비스롤 전환 후 `auth.uid()`는 항상 NULL이므로 실질
 * 동작은 "앱이 명시한 updated_by를 그대로 쓴다"였다(`systemSettingsWrite.ts`
 * 참고). `log_system_settings_change`도 그 교정판에서 `changed_by`를
 * `NEW.updated_by`(=앱이 명시한 actorId)에서 가져오도록 이미 바뀌어 있었다.
 *
 * `updateSystemSetting`은 이 두 트리거를 **하나의 SQLite 트랜잭션**으로
 * 재현한다:
 *   1) 대상 행을 먼저 읽어 `id`와 `old_value`를 확보한다(없으면
 *      `SettingNotFoundError` — `systemSettingsWrite.ts`의 UPDATE 전용 계약과
 *      동일하게 UPSERT가 아니다).
 *   2) `setting_value`/`updated_at`/`updated_by`를 갱신한다(BEFORE UPDATE
 *      트리거 재현 — `updated_by`는 항상 `actorId`로, COALESCE의 "이미 명시된
 *      값" 분기만 남았으므로 무조건 값이 있다).
 *   3) `system_settings_history`에 `old_value`/`new_value`/`changed_by`(=
 *      `actorId`, 트리거가 참조하던 `NEW.updated_by`와 동일값)를 기록한다
 *      (AFTER UPDATE 트리거 재현). **이 기록이 "누가 언제 설정을 바꿨는가"의
 *      유일한 이력이다 — 빠뜨리면 안 된다.**
 * `db.transaction()`을 쓰는 이유: 2)의 결과(old_value)를 3)에 넘겨야 하는
 * 읽기-후-쓰기 의존이라 `db.batch()`(고정 배열, 결과 분기 불가)로는 표현할
 * 수 없다. 관리자 설정 변경은 뜨거운 경로가 아니므로 대화형 트랜잭션의
 * 왕복 비용은 문제되지 않는다(activities.ts의 `db.batch()` 채택 이유였던
 * 뜨거운 경로 최적화와는 다른 상황).
 */

import { and, eq, inArray } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  SETTING_CATEGORY,
  SYSTEM_SETTING_CATEGORY,
  defaultSettings,
  systemSettings,
  systemSettingsHistory,
  userSettings,
} from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type SettingCategoryValue = (typeof SETTING_CATEGORY)[number]
export type SystemSettingCategoryValue = (typeof SYSTEM_SETTING_CATEGORY)[number]

// -------------------------------------------------------------------------
// user_settings / default_settings — get_user_settings RPC 대체
// -------------------------------------------------------------------------

export interface UserSettingRow {
  category: SettingCategoryValue
  setting_key: string
  setting_value: unknown
  is_default: boolean
  description: string | null
}

/**
 * `get_user_settings(p_user_id)` RPC 대체. 모듈 설명 참고 — `userId`는 항상
 * 명시해서 부른다(원본의 `auth.uid()` 폴백 분기는 호출부가 쓴 적이 없다).
 * 카테고리 필터는 원본 RPC에도 없었다 — 호출부(`/api/settings` GET)가
 * 전체를 받아 애플리케이션에서 필터링한다(그 형태를 유지한다).
 */
export async function getUserSettings(userId: string): Promise<UserSettingRow[]> {
  const rows = await db
    .select({
      category: defaultSettings.category,
      settingKey: defaultSettings.settingKey,
      description: defaultSettings.description,
      defaultValue: defaultSettings.defaultValue,
      userSettingId: userSettings.id,
      userSettingValue: userSettings.settingValue,
    })
    .from(defaultSettings)
    .leftJoin(
      userSettings,
      and(
        eq(userSettings.userId, userId),
        eq(userSettings.category, defaultSettings.category),
        eq(userSettings.settingKey, defaultSettings.settingKey)
      )
    )
    .orderBy(defaultSettings.category, defaultSettings.settingKey)

  return rows.map(row => ({
    category: row.category,
    setting_key: row.settingKey,
    setting_value: row.userSettingId === null ? row.defaultValue : row.userSettingValue,
    is_default: row.userSettingId === null,
    description: row.description,
  }))
}

/**
 * `getUserSettings`의 배치판 — 여러 회원의 설정을 **쿼리 2회**로 읽는다
 * (기본값 표 1회 + 사용자 오버라이드 1회). 회원 한 명당 한 쿼리를 날리던
 * 호출부(지원사업 발행)를 위해 만들었다: `Promise.all`이라 지연은 병렬이어도
 * 원격 커넥션에는 회원 수만큼 왕복이 꽂힌다.
 *
 * **기본값 합성은 `getUserSettings`와 글자 그대로 같아야 한다** — 여기서
 * 어긋나면 수신 설정이 조용히 다르게 읽혀 알림이 잘못 나간다. 그래서 단건
 * 함수와 동일하게: `default_settings` 전 행을 기준으로, 그 회원의 오버라이드
 * 행이 없으면 `default_value` + `is_default: true`, 있으면 그 값 +
 * `is_default: false`. 정렬도 `category, setting_key`로 같다.
 *
 * `ids`가 비면 쿼리 없이 빈 Map을 돌려준다(`getProfilesByIds`와 같은 계약 —
 * Drizzle `inArray()`에 빈 배열을 넘기면 유효하지 않은 SQL이 된다).
 *
 * @returns userId → 그 회원의 설정 행 배열. 요청한 id는 오버라이드가 하나도
 *   없어도 **기본값 전체**가 담긴 항목으로 들어간다(단건 함수와 동일).
 */
export async function getUserSettingsByUserIds(
  ids: string[]
): Promise<Map<string, UserSettingRow[]>> {
  if (ids.length === 0) return new Map()
  const uniqueIds = [...new Set(ids)]

  const [defaults, overrides] = await Promise.all([
    db
      .select({
        category: defaultSettings.category,
        settingKey: defaultSettings.settingKey,
        description: defaultSettings.description,
        defaultValue: defaultSettings.defaultValue,
      })
      .from(defaultSettings)
      .orderBy(defaultSettings.category, defaultSettings.settingKey),
    db
      .select({
        userId: userSettings.userId,
        category: userSettings.category,
        settingKey: userSettings.settingKey,
        settingValue: userSettings.settingValue,
      })
      .from(userSettings)
      .where(inArray(userSettings.userId, uniqueIds)),
  ])

  // (userId, category, settingKey) → 오버라이드 값. 단건 함수의 LEFT JOIN
  // 조건(user_id + category + setting_key)을 그대로 옮긴 키다.
  const overrideByKey = new Map<string, unknown>()
  for (const row of overrides) {
    overrideByKey.set(`${row.userId}\u0000${row.category}\u0000${row.settingKey}`, row.settingValue)
  }

  const result = new Map<string, UserSettingRow[]>()
  for (const userId of uniqueIds) {
    result.set(
      userId,
      defaults.map(d => {
        const key = `${userId}\u0000${d.category}\u0000${d.settingKey}`
        const hasOverride = overrideByKey.has(key)
        return {
          category: d.category,
          setting_key: d.settingKey,
          setting_value: hasOverride ? overrideByKey.get(key) : d.defaultValue,
          is_default: !hasOverride,
          description: d.description,
        }
      })
    )
  }
  return result
}

export interface UpsertUserSettingInput {
  userId: string
  category: SettingCategoryValue
  settingKey: string
  settingValue: unknown
}

/**
 * `upsert_user_setting` RPC의 `auth.uid()` 의존을 없애고(단계 2b-4에서 이미
 * 앱 계층 직접 upsert로 전환됨 — `src/app/api/settings/route.ts` 참고) Turso로
 * 옮긴다. `user_settings_user_category_key_idx`(user_id, category,
 * setting_key) 유니크 인덱스 충돌 시 값과 `updated_at`만 갱신한다.
 * @returns 생성/갱신된 행의 id.
 */
export async function upsertUserSetting(input: UpsertUserSettingInput): Promise<string> {
  const [row] = await db
    .insert(userSettings)
    .values({
      userId: input.userId,
      category: input.category,
      settingKey: input.settingKey,
      settingValue: input.settingValue,
    })
    .onConflictDoUpdate({
      target: [userSettings.userId, userSettings.category, userSettings.settingKey],
      set: {
        settingValue: input.settingValue,
        updatedAt: new Date(),
      },
    })
    .returning({ id: userSettings.id })

  return row.id
}

export interface ResetUserSettingsInput {
  userId: string
  category?: SettingCategoryValue | null
  settingKey?: string | null
}

/**
 * `reset_user_settings` RPC의 `auth.uid()` 의존을 없애고(단계 2b-4에서 이미
 * 앱 계층 직접 DELETE로 전환됨 — `src/app/api/settings/reset/route.ts` 참고)
 * Turso로 옮긴다. `userId`로만 스코프하고(다른 사용자 설정은 절대 건드리지
 * 않는다) `category`/`settingKey`가 있으면 추가로 좁힌다.
 * @returns 삭제된 행의 id 목록(원본이 돌려주던 `deleted_count`는 호출부가
 * `.length`로 구한다 — Supabase `.select('id')` 뒤 `.length`와 동일한 계약).
 */
export async function resetUserSettings(input: ResetUserSettingsInput): Promise<string[]> {
  const conditions = [eq(userSettings.userId, input.userId)]
  if (input.category) conditions.push(eq(userSettings.category, input.category))
  if (input.settingKey) conditions.push(eq(userSettings.settingKey, input.settingKey))

  const deleted = await db
    .delete(userSettings)
    .where(and(...conditions))
    .returning({ id: userSettings.id })

  return deleted.map(row => row.id)
}

// -------------------------------------------------------------------------
// system_settings — get_system_settings 조회 + 트리거 2종을 재현하는 쓰기
// -------------------------------------------------------------------------

export interface SystemSettingRow {
  id: string
  category: SystemSettingCategoryValue
  setting_key: string
  setting_value: unknown
  description: string | null
  is_sensitive: boolean
  created_at: string
  updated_at: string | null
  updated_by: string | null
}

function rowToSystemSetting(row: typeof systemSettings.$inferSelect): SystemSettingRow {
  return {
    id: row.id,
    category: row.category,
    setting_key: row.settingKey,
    setting_value: row.settingValue,
    description: row.description,
    is_sensitive: row.isSensitive,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt),
    updated_by: row.updatedBy,
  }
}

/**
 * 민감한 설정값을 마스킹한다. 원본 `get_system_settings` RPC의 마스킹
 * 분기(`WHEN ss.is_sensitive AND NOT (include_sensitive AND is_admin)`)를
 * 옮긴 것이다 — 다만 "관리자인가"는 이 쿼리 계층이 판단하지 않는다(모듈
 * 설명 참고). 호출부가 이미 관리자 인증을 통과한 뒤에 `includeSensitive`
 * 하나로 마스킹 여부를 정한다. 순수 데이터 변환 함수라 DB에 접근하지
 * 않는다.
 */
export function maskSensitiveSystemSetting(
  row: SystemSettingRow,
  includeSensitive: boolean
): SystemSettingRow {
  if (!row.is_sensitive || includeSensitive) return row
  return {
    ...row,
    setting_value: {
      masked: true,
      description: '민감한 정보는 관리자만 조회할 수 있습니다',
    },
  }
}

/**
 * `get_system_settings(include_sensitive)` RPC 대체. `category, setting_key`
 * 오름차순 정렬은 원본과 동일하다. 마스킹은 `maskSensitiveSystemSetting`에
 * 위임한다 — 호출부가 무엇을 근거로 `includeSensitive`를 정할지는 이 모듈이
 * 모른다.
 */
export async function listSystemSettings(includeSensitive: boolean): Promise<SystemSettingRow[]> {
  const rows = await db
    .select()
    .from(systemSettings)
    .orderBy(systemSettings.category, systemSettings.settingKey)

  return rows.map(row => maskSensitiveSystemSetting(rowToSystemSetting(row), includeSensitive))
}

export class SettingNotFoundError extends Error {
  constructor(category: string, settingKey: string) {
    super(`존재하지 않는 설정입니다: ${category}.${settingKey}`)
    this.name = 'SettingNotFoundError'
  }
}

export interface UpdateSystemSettingInput {
  category: SystemSettingCategoryValue
  settingKey: string
  settingValue: unknown
  /** 이미 검증된 관리자 id. BEFORE UPDATE 트리거가 채우던 `updated_by`와
   * AFTER UPDATE 트리거가 채우던 `changed_by`에 그대로 쓰인다(모듈 설명). */
  actorId: string
}

/**
 * `system_settings` UPDATE + 트리거 2종(모듈 설명 참고) 재현. UPDATE
 * 전용이다 — 대상이 없으면 `SettingNotFoundError`를 던진다(UPSERT가 아니다,
 * `systemSettingsWrite.ts`의 기존 계약과 동일).
 */
export async function updateSystemSetting(
  input: UpdateSystemSettingInput
): Promise<{ id: string }> {
  return db.transaction(async tx => {
    const [existing] = await tx
      .select({ id: systemSettings.id, settingValue: systemSettings.settingValue })
      .from(systemSettings)
      .where(
        and(
          eq(systemSettings.category, input.category),
          eq(systemSettings.settingKey, input.settingKey)
        )
      )
      .limit(1)

    if (!existing) throw new SettingNotFoundError(input.category, input.settingKey)

    const now = new Date()

    // BEFORE UPDATE 트리거(update_system_settings_updated_at) 재현.
    await tx
      .update(systemSettings)
      .set({
        settingValue: input.settingValue,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(eq(systemSettings.id, existing.id))

    // AFTER UPDATE 트리거(log_system_settings_change) 재현 — 유일한 변경
    // 이력이다.
    await tx.insert(systemSettingsHistory).values({
      settingId: existing.id,
      category: input.category,
      settingKey: input.settingKey,
      oldValue: existing.settingValue,
      newValue: input.settingValue,
      changedBy: input.actorId,
    })

    return { id: existing.id }
  })
}
