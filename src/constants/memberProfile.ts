/**
 * `member_profiles`의 값 제약 — Postgres 시절 CHECK로 걸려 있던 것들.
 *
 * Turso 이전에서 CHECK 제약이 통째로 사라졌고(운영 `sqlite_master` 전문에
 * `CHECK` 0건), SQLite는 표를 재작성하지 않고는 CHECK를 다시 붙일 수 없다.
 * 그래서 **막는 일은 앱이 한다.** 이 파일은 그 값 목록의 정본이고, 라우트가
 * 각자 리터럴을 적어 두던 것을 여기로 모은 것이다.
 *
 * 왜 모으는가: `monthly_fee`의 상·하한이 `member-signup` 라우트에는
 * 10000/50000으로, `mypage/profile` 라우트에는 0/10_000_000으로 서로 다르게
 * 적혀 있었다. 가입할 때는 막히는 값이 프로필 수정으로는 들어갔고, DB에
 * CHECK가 없으니 아무도 몰랐다. 상수가 한 곳에 있으면 그런 어긋남이 생길
 * 자리가 없다.
 *
 * 사후 탐지는 `scripts/turso/check-invariants.mjs`가 맡는다(손으로 친 SQL
 * 처럼 앱을 지나지 않는 쓰기용).
 */

/** 원본: `member_profiles_monthly_fee_check` — `monthly_fee BETWEEN 10000 AND 50000`. */
export const MONTHLY_FEE_MIN = 10000
export const MONTHLY_FEE_MAX = 50000

/**
 * 원본 CHECK는 컬럼이 nullable이라 **NULL을 허용한다**(Postgres의 CHECK는
 * 결과가 NULL이면 통과시킨다). 그래서 "값 없음"과 "범위 밖"을 구분해서
 * 돌려준다:
 *
 * - `{ ok: true, value: null }` — 값을 보내지 않았다(빈 문자열·undefined·null)
 * - `{ ok: true, value: n }` — 범위 안의 정수
 * - `{ ok: false }` — 범위 밖이거나 정수가 아니다 → 호출부가 400을 준다
 *
 * 예전 `mypage/profile`은 값이 없으면 **0**으로 떨어뜨려 저장했다. 0은 원본
 * CHECK가 거부하던 값이다 — 그 경로가 이 함수로 바뀌면서 NULL이 된다.
 *
 * **`0`은 "값 없음"으로 받는다.** 범위 밖이라고 400을 주면 안 된다 —
 * 마이페이지 폼이 `profile.monthly_fee || 0`으로 초기화해서 회비가 없는
 * 조합원에 대해 **항상 0을 보내기 때문**이다(`ProfileEditForm.tsx:20,129`).
 * 0을 거부하면 그 조합원들은 이름·전화번호조차 저장할 수 없게 된다
 * (운영 실측 2026-09-01: 회비가 NULL이거나 0인 조합원 **4명**). 폼이 0을
 * "없음"의 뜻으로 쓰고 있으니 서버도 같은 뜻으로 받는 것이 맞고, 저장되는
 * 값은 원본 CHECK가 허용하던 NULL이다.
 */
export type MonthlyFeeParseResult = { ok: true; value: number | null } | { ok: false }

export function parseMonthlyFee(raw: unknown): MonthlyFeeParseResult {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'number' && typeof raw !== 'string') return { ok: false }

  const value = Number(raw)
  if (!Number.isInteger(value)) return { ok: false }
  // 0 = "회비 없음". 폼이 그렇게 보낸다(위 주석 참조).
  if (value === 0) return { ok: true, value: null }
  if (value < MONTHLY_FEE_MIN || value > MONTHLY_FEE_MAX) return { ok: false }
  return { ok: true, value }
}

export const MONTHLY_FEE_RANGE_MESSAGE = `월 회비는 ${MONTHLY_FEE_MIN.toLocaleString()}원 이상 ${MONTHLY_FEE_MAX.toLocaleString()}원 이하이어야 합니다.`

/** 원본: `check_artist_role`. */
export const ARTIST_ROLES = ['owner', 'manager', 'collaborator'] as const
export type ArtistRole = (typeof ARTIST_ROLES)[number]

export function isValidArtistRole(value: unknown): value is ArtistRole {
  return typeof value === 'string' && (ARTIST_ROLES as readonly string[]).includes(value)
}

/**
 * 원본: `member_profiles_membership_type_check`.
 *
 * 현재 이 컬럼에 쓰는 앱 경로는 **하나도 없다**(전원이 DB 기본값 `'regular'`).
 * 그래서 런타임 검증을 붙일 자리도 없지만, 목록은 여기 남긴다 — 쓰기 경로가
 * 생기는 날 리터럴을 새로 적는 대신 이걸 쓰라는 뜻이고,
 * `src/db/queries/profiles.ts`의 `ProfileRow['membership_type']`이 이 유니온을
 * 참조해 **타입 검사가 임의 문자열을 먼저 막는다.**
 */
export const MEMBERSHIP_TYPES = ['regular', 'premium', 'lifetime'] as const
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number]

/**
 * 원본: `member_profiles_registration_status_check`.
 *
 * 이전에서 CHECK 제약이 사라졌으므로(운영 `sqlite_master`에 CHECK 0건) 이 배열이
 * 값 목록의 정본이다. `scripts/turso/check-invariants.mjs`가 같은 목록으로
 * 운영 데이터를 매일 확인한다 — 둘이 어긋나면 탐지기가 정상 데이터를 위반으로
 * 보고하거나 그 반대가 된다.
 */
export const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

/** 탈퇴 확정 후 화면에 찍히는 이름. 콘텐츠는 남고 작성자만 이것으로 바뀐다. */
export const WITHDRAWN_DISPLAY_NAME = '탈퇴한 조합원'

/**
 * 탈퇴 시 넣는 자리표시자 이메일.
 *
 * `member_profiles.email`과 `user.email`이 둘 다 NOT NULL이고 UNIQUE라
 * 비울 수 없다. 자리표시자로 바꾸는 순간 **원래 주소가 풀려** 그 사람이
 * 나중에 같은 이메일로 재가입할 수 있다(설계 결정 5).
 *
 * `.invalid`는 RFC 2606이 예약한 도메인이라 실수로 메일이 발송되지 않는다.
 */
export function withdrawnEmailFor(id: string): string {
  return `withdrawn+${id}@ggac.invalid`
}
