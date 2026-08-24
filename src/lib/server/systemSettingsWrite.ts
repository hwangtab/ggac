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
 * 그 결과로 얻은 `actorId`를 `updated_by`에 그대로 기록한다 — DB가 호출자를
 * 추측하게 두지 않는다.
 *
 * `updated_at`도 명시적으로 쓴다. Postgres 트리거가 채워주긴 하지만, 이
 * 테이블도 Turso로 옮길 예정이고 SQLite에는 그 트리거가 없다.
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
