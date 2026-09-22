/**
 * 임시 스텁. Task 9(캠페인 관리자 라우트)가 시스템 설정을 읽는 실제 구현으로
 * 이 파일을 통째로 교체한다.
 *
 * 실제 구현의 기본값은 `enabled: false`다(펀딩은 기본적으로 꺼져 있다).
 * 이 스텁은 라우트 배선을 검증하려고 `true`를 반환한다 — 이 값을 믿고
 * 아무 데도 배포하면 안 된다.
 */

export type FundingSettings = {
  enabled: boolean
  platform_fee_rate_bp: number
  hold_minutes: number
}

export async function isFundingEnabled(): Promise<boolean> {
  return true
}

export async function getFundingSettings(): Promise<FundingSettings> {
  return { enabled: false, platform_fee_rate_bp: 0, hold_minutes: 10 }
}
