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

/** 비조합원 요율 5.5%(부가세 포함). 이 요율이 붙는 길은 아래 참고. */
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
 * ## 비조합원 요율이 붙는 길
 *
 * 조합원이 스스로 여는 개설(`requireActiveMember`)은 승인 시점에도 대개
 * 조합원이라 3.3%가 붙는다. 비조합원 요율은 관리자 대리 개설
 * (`POST /api/admin/funding/campaigns`)로 조합원이 아닌 회원을 개설자로 지정했을
 * 때, 또는 개설 뒤 승인 전에 자격이 풀렸을 때 붙는다.
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

// ---------------------------------------------------------------------------
// 사무국이 읽고 쓰는 단위 — 퍼센트
// ---------------------------------------------------------------------------

/**
 * 저장·계산은 만분율(bp)로 하지만 **사무국은 퍼센트로 말한다.** 조합이 정한
 * 규칙도 "3.3%·5.5%"이지 "330bp·550bp"가 아니다. 그래서 관리자 화면의 칸은
 * 퍼센트를 받고 퍼센트를 보여 주며, bp는 이 파일 안에서만 오간다.
 *
 * 한 자리(1bp)가 0.01%이므로 소수점 **둘째 자리까지** 표현된다. 셋째 자리는
 * bp로 옮길 수 없어 받지 않는다 — 반올림해서 조용히 다른 값을 저장하면
 * 화면에 적힌 숫자와 실제로 떼는 돈이 갈라진다.
 */
export const MAX_FEE_RATE_PERCENT = MAX_FEE_RATE_BP / 100

/**
 * 범위를 벗어난 입력에 화면이 돌려주는 한 문장. **범위를 숫자로 말한다** —
 * "올바른 값을 입력하세요"는 무엇이 올바른지 알려 주지 않는다.
 */
export const FEE_RATE_RANGE_MESSAGE = `수수료율은 0%에서 ${MAX_FEE_RATE_PERCENT}% 사이, 소수점 둘째 자리까지 입력할 수 있습니다.`

/**
 * 사무국이 입력한 퍼센트를 저장 단위(bp)로 옮긴다. 옮길 수 없으면 `null`이고,
 * 호출부는 `FEE_RATE_RANGE_MESSAGE`를 띄운다 — **저장 가능한 다른 값으로
 * 바꿔치기하지 않는다.**
 *
 * 빈 칸과 `null`·`undefined`를 따로 막는 이유: `Number('')`도 `Number(null)`도
 * `0`이다. 그대로 두면 칸을 비운 순간 수수료가 0%로 저장된다.
 *
 * 부동소수점: `3.3 * 100`은 `330.00000000000006`이라 `Math.round`가 필요하고,
 * 그 반올림이 **자릿수를 잘라내는 일까지** 하면 안 되므로 반올림 전후의 차이를
 * 함께 본다(3.333% → 333.3 → 차이 0.3 → 거부).
 */
export function feeRatePercentToBp(percent: unknown): number | null {
  if (percent === null || percent === undefined) return null
  if (typeof percent === 'string' && percent.trim() === '') return null
  if (typeof percent !== 'number' && typeof percent !== 'string') return null

  const n = Number(percent)
  if (!Number.isFinite(n)) return null

  const scaled = n * 100
  const bp = Math.round(scaled)
  if (Math.abs(scaled - bp) > 1e-6) return null
  if (bp < 0 || bp > MAX_FEE_RATE_BP) return null
  return bp
}
