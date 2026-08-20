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
    // is_member 컬럼의 DB 기본값은 true라 생략해도 결과는 같지만, 같은 테이블을
    // 쓰는 `signupProfile.ts`의 `buildSignupProfileRow`가 이 컬럼을 명시적으로
    // 적는다 — 두 빌더가 같은 컬럼 집합에 합의하도록 여기도 명시한다. 한쪽만
    // 명시하면 "여긴 왜 빠졌지"라는 의문과, DB 기본값이 나중에 바뀌었을 때
    // 두 빌더가 조용히 갈라질 여지를 함께 남긴다.
    is_member: true,
  }
}
