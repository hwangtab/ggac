/**
 * 플랫폼 수수료율 — **누구에게 얼마를 매기는가**를 정하는 유일한 자리.
 *
 * 조합 결정(2026-09-25): **조합원 3.3%, 비조합원 5.5%.**
 *
 * 두 숫자는 모두 **부가세를 포함한 값**이다(3%·5% + 부가세 10%). 세금을 따로
 * 모델링하지 않고 각각을 하나의 전액 요율로 다룬다 — 그래서 사무국이 이
 * 숫자를 읽는 자리마다 "부가세 포함"이라고 적는다. 화면에 3.3%만 떠 있으면
 * 다음 사람이 여기에 부가세를 한 번 더 얹는다.
 *
 * 단위는 기존과 같은 만분율(bp)이고 상한도 그대로 3000bp다 — 금액 계산
 * (`settlement.ts`의 `platformFeeFor`)은 한 글자도 바뀌지 않는다.
 *
 * 이 파일은 **아무것도 import 하지 않는다.** 관리자 승인 화면(클라이언트
 * 컴포넌트)이 승인 전에 요율을 표시해야 하므로 순수한 채로 남아야 한다.
 */

/** 만분율 상한. 설정에 무엇이 들어와도 이 위로는 올라가지 않는다. */
export const MAX_FEE_RATE_BP = 3000

/** 조합원 요율 3.3%(부가세 포함). */
export const MEMBER_FEE_RATE_BP = 330

/** 비조합원 요율 5.5%(부가세 포함). 오늘 이 요율이 붙을 길은 아래 참고. */
export const NONMEMBER_FEE_RATE_BP = 550

/** 요율 옆에 늘 함께 적는 말. 사무국이 읽는 자리에서 빠지면 안 된다. */
export const FEE_RATE_VAT_NOTE = '부가세 포함'

/** 두 요율 한 벌. 설정에서 읽어 오고, 승인 시점에 한쪽이 골라진다. */
export interface FundingFeeRates {
  member_bp: number
  nonmember_bp: number
}

/** 판정에 필요한 두 칸만. 프로필 전체를 들고 다니지 않는다. */
export interface FeeMemberProfile {
  registration_status?: string | null
  is_active?: boolean | null
}

/**
 * 이 개설자를 조합원으로 볼 것인가 — **이 질문의 답은 여기서만 정한다.**
 *
 * ## `is_member`도 `membership_type`도 쓰지 않는다
 *
 * 두 컬럼은 스키마 기본값(`is_member=1`, `membership_type='regular'`)이 모든
 * 행에 그대로 박혀 있다. 2026-09-25 운영 DB 23행 전부가 그 값이고, **그중에는
 * 아직 승인되지 않은 가입 신청도 있다.** 즉 두 컬럼은 오늘 아무 신호도 담고
 * 있지 않고, 그것으로 판정하면 승인 대기자에게 조합원 요율이 간다. 언젠가
 * 그 컬럼에 진짜 뜻이 들어오더라도, 그때 이 함수를 고치는 것이지 지금 미리
 * 읽어 두는 것이 아니다.
 *
 * ## 신호를 담고 있는 것은 가입 승인 상태다
 *
 * 조합 가입이 승인되고(`registration_status='approved'`) 자격이 살아 있는
 * (`is_active`) 사람이 조합원이다. 이 사이트의 조합원 전용 경계가 전부 같은
 * 판정을 쓴다(`isApprovedActive` — `src/lib/server/authz.ts`). 수수료만 다른
 * 잣대를 쓰면 "조합원 전용 기능은 못 쓰는데 조합원 요율은 받는" 사람이 생긴다.
 *
 * 같은 판정을 여기 순수 함수로 한 벌 더 두는 이유는 하나다 — `authz.ts`는
 * `next/headers`에 닿아 있어 클라이언트 번들에 들어갈 수 없는데, 이 판정의
 * 결과는 관리자 화면이 **승인 전에** 보여 줘야 한다. 두 함수가 갈라지지
 * 않는지는 `scripts/testing/fundingFeeRate.test.mjs`가 진짜 `isApprovedActive`를
 * 불러 대조한다.
 */
export function isFeeMember(profile: FeeMemberProfile | null | undefined): boolean {
  return profile?.registration_status === 'approved' && profile?.is_active === true
}

/**
 * 승인 시점에 캠페인에 새길 요율을 고른다.
 *
 * ## 비조합원 요율에는 오늘 길이 없다
 *
 * 캠페인 개설은 `requireActiveMember`(승인·활성 조합원)만 통과한다
 * (`src/app/api/mypage/funding/campaigns/route.ts`). 그래서 개설 → 제출 →
 * 승인을 정상적으로 밟은 캠페인의 개설자는 승인 시점에도 조합원이고,
 * `nonmember_bp`는 **적용되지 않는다.** 남는 길은 둘뿐이다 — 개설한 뒤 승인
 * 전에 조합원 자격이 풀렸거나(탈퇴·비활성), 프로필 행이 사라졌거나. 둘 다
 * 정상 흐름이 아니다.
 *
 * 그래도 두 요율을 다 둔다. 조합이 정한 규칙이고, 규칙이 없는 것과 쓰이지
 * 않는 것은 다르다. 대신 **살아 있는 척하지 않는다** — 관리자 승인 화면이
 * "비조합원 요율은 지금 개설 경로로는 붙지 않는다"고 적어 두고, 이 주석이
 * 같은 말을 한다. 개설 경계를 넓히는 날(비조합원 개설 허용) 이 문단을 지우면
 * 된다.
 */
export function platformFeeRateFor(
  rates: FundingFeeRates,
  profile: FeeMemberProfile | null | undefined
): { rate_bp: number; is_member: boolean } {
  const member = isFeeMember(profile)
  return { rate_bp: member ? rates.member_bp : rates.nonmember_bp, is_member: member }
}

/** 만분율을 화면용 백분율 문자열로. 330 → `'3.3'`. 표시 전용이다. */
export function formatFeeRatePercent(bp: unknown): string {
  const n = Number(bp)
  return String((Number.isFinite(n) ? n : 0) / 100)
}

/** 사무국이 읽는 한 줄. 예: `3.3% (조합원 · 부가세 포함)`. */
export function feeRateLabel(bp: unknown, isMember: boolean): string {
  return `${formatFeeRatePercent(bp)}% (${isMember ? '조합원' : '비조합원'} · ${FEE_RATE_VAT_NOTE})`
}

/**
 * 설정에서 읽은 값을 0~3000bp 정수로 가둔다. 범위 밖이거나 숫자가 아니면
 * `fallback`(= 조합이 정한 기본 요율)으로 떨어진다.
 */
export function clampFeeRateBp(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_FEE_RATE_BP ? n : fallback
}
