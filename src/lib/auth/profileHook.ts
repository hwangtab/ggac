/**
 * 가입 직후 만들 `member_profiles` 행을 조립한다.
 *
 * 로컬 import가 하나도 없어야 한다(테스트가 타입 스트리핑으로 읽는다).
 *
 * Postgres에서는 트리거 `handle_new_user`가 이 일을 했다. 그 트리거는 INSERT
 * 실패를 `EXCEPTION WHEN OTHERS ... RETURN NEW`로 삼켜서, 프로필 없는 사용자가
 * 조용히 생길 수 있었다. 이 함수를 쓰는 쪽은 그 실수를 반복하지 않는다 —
 * 실패하면 로그를 남기고 드러낸다.
 *
 * 새 가입자는 **항상** 승인 대기·비활성으로 시작한다. 관리자가 승인해야 조합원이
 * 된다. 이 함수가 권한 플래그를 켜는 경로는 존재하지 않는다.
 */

export function buildMemberProfileRow(input: {
  id: string
  email: string
  name?: string | null
}): Record<string, unknown> {
  if (!input?.id) throw new Error('프로필 생성에 id는 필수입니다.')
  if (!input?.email) throw new Error('프로필 생성에 email은 필수입니다.')

  const trimmedName = typeof input.name === 'string' ? input.name.trim() : ''

  return {
    id: input.id,
    email: input.email,
    display_name: trimmedName || input.email,
    registration_status: 'pending',
    is_active: false,
    is_admin: false,
    is_director: false,
    is_auditor: false,
  }
}
