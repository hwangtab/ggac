import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 로그인한 사용자의 안 읽은 알림을 모두 읽음 처리한다.
 *
 * 원래는 `mark_all_notifications_read()` RPC였다. 그 함수는
 * `WHERE user_id = auth.uid()` 하나로만 대상을 골랐는데, 단계 2b-5에서
 * `createSupabaseServer()`가 서비스롤 키를 쓰도록 바뀌면서 `auth.uid()`가 항상
 * NULL이 됐다. 그 결과 이 RPC는 **항상 0건**을 갱신하면서도 HTTP 200으로
 * 성공을 응답했다(운영 재현 완료). 세션에서 확인한 `userId`를 직접 조건으로
 * 쓴다.
 *
 * `.eq('user_id', userId)`는 다른 사용자의 알림을 건드리지 않기 위한 유일한
 * 방어선이다 — 이 줄이 빠지면 호출자가 모든 사용자의 안 읽은 알림을 한 번에
 * 읽음 처리하게 된다. `systemSettingsWrite.test.ts`가 그랬듯, 이 모듈도 그
 * 방어선이 실제로 쿼리에 들어가는지 스텁으로 고정한다.
 */
export async function markAllNotificationsRead(
  supabase: SupabaseClient,
  userId: string
): Promise<{ updatedIds: string[] }> {
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
    .select('id')

  if (error) throw error
  const rows = (data ?? []) as { id: string }[]
  return { updatedIds: rows.map(row => row.id) }
}
