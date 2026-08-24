import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 시스템 설정 저장.
 *
 * 원래는 `update_system_setting` RPC를 썼다. 그 함수는 `auth.uid()`로
 * `member_profiles.is_admin`을 조회해 관리자 여부를 판정하는데, 단계 2b-5에서
 * `createSupabaseServer()`가 서비스롤 키를 쓰도록 바뀌면서 `auth.uid()`가 항상
 * NULL이 됐다. 그 결과 이 RPC는 **모든 호출에서** `관리자 권한이 필요합니다`
 * 예외를 던지게 됐고, 관리자 설정 저장이 통째로 실패했다(운영 재현 완료).
 *
 * 관리자 판정은 이제 호출부의 `requireAdmin()`이 이미 끝낸 상태다. 여기서는
 * 그 결과로 얻은 `actorId`를 `updated_by`에 그대로 기록한다.
 *
 * 주의: `system_settings`에는 BEFORE UPDATE 트리거
 * (`update_system_settings_updated_at`)가 걸려 있고, 원래 그 트리거는
 * `NEW.updated_by = auth.uid()`로 **이 함수가 넘긴 값을 무조건 덮어썼다**
 * (auth.uid()가 NULL이니 결국 NULL로 지워졌다 — 리뷰에서 운영 재현·확인).
 * `supabase/migrations/20260824040000_fix_system_settings_trigger_actor_precedence.sql`이
 * 그 트리거를 `COALESCE(NEW.updated_by, auth.uid())`로 고쳐서, 이 함수가 명시한
 * `actorId`가 실제로 살아남게 만든다. 그 마이그레이션이 운영에 적용되기 전까지는
 * `updated_by`를 여기서 아무리 명시해도 트리거가 다시 NULL로 되돌린다.
 *
 * `updated_at`도 명시적으로 쓴다. Postgres 트리거가 채워주긴 하지만, 이
 * 테이블도 Turso로 옮길 예정이고 SQLite에는 그 트리거가 없다.
 *
 * UPDATE 전용이다 — UPSERT가 아니다. 대체 대상이던 RPC는
 * `INSERT ... ON CONFLICT DO UPDATE`였어서 행이 없으면 새로 만들었지만, 이
 * 함수는 대상이 없으면 `SettingNotFoundError`를 던진다. 지금은 무해하다
 * (시드된 19개 키 = `DEFAULT_SETTINGS` 19개 키, 정확히 일치). 다만 백업
 * 복원(`/api/admin/settings/backup`)에서 테이블에 없는 키가 담긴 백업 파일을
 * 올리면, 예전엔 조용히 새로 생성됐을 그 키가 지금은 `errors` 배열로
 * 떨어진다 — 의도한 동작 변경이며 UPDATE 전용을 유지한다.
 */
export class SettingNotFoundError extends Error {
  constructor(category: string, settingKey: string) {
    super(`존재하지 않는 설정입니다: ${category}.${settingKey}`)
    this.name = 'SettingNotFoundError'
  }
}

type UpdateArgs = {
  category: string
  settingKey: string
  settingValue: unknown
  actorId: string
}

export async function updateSystemSetting(
  admin: SupabaseClient,
  { category, settingKey, settingValue, actorId }: UpdateArgs
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('system_settings')
    .update({
      setting_value: settingValue,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq('category', category)
    .eq('setting_key', settingKey)
    .select('id')

  if (error) throw error
  const rows = (data ?? []) as { id: string }[]
  if (rows.length === 0) throw new SettingNotFoundError(category, settingKey)
  return { id: rows[0].id }
}
