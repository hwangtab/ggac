/**
 * 가입 폼 입력 → Supabase `member_profiles` 행.
 *
 * 키는 **snake_case**다. 단계 2b-1에서 이 프로젝트는 정확히 이 지점에서
 * 한 번 데였다 — snake_case를 돌려주는 함수의 결과를 camelCase를 기대하는
 * ORM에 넘겨 `NOT NULL constraint failed`가 났다. 여기서는 Supabase REST에
 * 그대로 넘기므로 snake_case가 맞다.
 *
 * 클라이언트가 보낸 `registration_status`·`is_admin` 따위는 **읽지 않는다.**
 * 신규 가입자는 무조건 승인 대기·비활성이다.
 *
 * 실측(2026-08-19, 로컬 스택 `member_profiles`):
 * - `monthly_fee`는 CHECK (monthly_fee >= 10000 AND monthly_fee <= 50000).
 *   이 컬럼은 nullable이라 값을 아예 안 보내는 것 자체는 허용되지만, 값을
 *   보낸다면 이 범위를 벗어나면 DB가 23514로 거부한다. 라우트(Step 3)가
 *   이 범위를 400으로 미리 걸러야 500을 피한다.
 * - `registration_status`는 CHECK (IN 'pending','approved','rejected') —
 *   여기서 하드코딩하는 'pending'은 그 허용값 중 하나다.
 * - birth_date/phone_number/real_name/bank_name/account_number/
 *   account_holder는 전부 nullable이고 타입 외 CHECK 제약이 없다
 *   (birth_date는 date 타입).
 */

export interface SignupProfileInput {
  id: string
  email: string
  display_name?: unknown
  real_name?: unknown
  phone_number?: unknown
  birth_date?: unknown
  monthly_fee?: unknown
  bank_name?: unknown
  account_number?: unknown
  account_holder?: unknown
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

export function buildSignupProfileRow(input: SignupProfileInput): Record<string, unknown> {
  const displayName = text(input.display_name)
  if (!displayName) {
    throw new Error('표시명이 필요합니다.')
  }

  return {
    id: input.id,
    email: input.email,
    display_name: displayName,
    real_name: text(input.real_name),
    phone_number: text(input.phone_number),
    // date 컬럼이다 — 'YYYY-MM-DD' 문자열 그대로 둔다. 밀리초로 바꾸면
    // 타임존 해석이 끼어들어 생일이 하루 밀린다.
    birth_date: text(input.birth_date),
    monthly_fee: integer(input.monthly_fee),
    bank_name: text(input.bank_name),
    account_number: text(input.account_number),
    account_holder: text(input.account_holder),
    // 아래는 전부 클라이언트 입력을 절대 반영하지 않는다. `profileHook.ts`의
    // `buildMemberProfileRow`(가입 훅의 기본 프로필)와 같은 컬럼 집합에 맞춘다
    // — 두 빌더가 같은 테이블에 부분적으로 다른 컬럼만 쓰면 한쪽만 고쳤을 때
    // 드리프트가 생긴다.
    registration_status: 'pending',
    is_active: false,
    is_admin: false,
    is_member: true,
    is_director: false,
    is_auditor: false,
  }
}
