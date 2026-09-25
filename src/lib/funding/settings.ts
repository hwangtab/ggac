import {
  clampFeeRateBp,
  MEMBER_FEE_RATE_BP,
  NONMEMBER_FEE_RATE_BP,
  type FundingFeeRates,
} from '@/lib/funding/feeRate'
import { getSystemSettings } from '@/utils/systemSettings'

export interface FundingSettings {
  enabled: boolean
  /** 조합원 요율(bp). 기본 330 = 3.3%, 부가세 포함. */
  platform_fee_rate_member_bp: number
  /** 비조합원 요율(bp). 기본 550 = 5.5%, 부가세 포함. */
  platform_fee_rate_nonmember_bp: number
  hold_minutes: number
}

const DEFAULTS: FundingSettings = {
  enabled: false,
  platform_fee_rate_member_bp: MEMBER_FEE_RATE_BP,
  platform_fee_rate_nonmember_bp: NONMEMBER_FEE_RATE_BP,
  hold_minutes: 10,
}

/**
 * 관리자 화면에서 무엇을 넣든 여기서 범위를 지킨다. 두 수수료율 모두 만분율
 * 0~3000이고, 범위 밖이면 조합이 정한 기본 요율로 떨어진다.
 *
 * ## 운영 DB에 남은 옛 키는 어떻게 되는가 — 마이그레이션은 없다
 *
 * `system_settings`의 `features/funding_features` 행은 JSON 한 덩어리이고,
 * 거기 요율은 아직 `platform_fee_rate_bp` **한 칸**으로 들어 있다. 그 키는
 * 오늘부터 아무도 읽지 않는다. 행을 고치지 않고 스크립트도 돌리지 않는다.
 *
 * 그래서 벌어지는 일: 새 키가 없으니 두 요율 모두 여기 적힌 기본값
 * (330bp·550bp)으로 읽힌다 — 그것이 곧 조합이 방금 정한 규칙이라 결과가
 * 맞다. 승인된 캠페인이 아직 하나도 없어 옛 값으로 새겨진 요율도 없다. 옛
 * 키는 사무국이 다음에 설정을 저장할 때까지 행에 남아 있다가(설정 저장은
 * 모르는 키를 보존한다) 그대로 잊힌다.
 *
 * **모양이 어긋나도 펀딩은 멈추지 않는다.** 이 함수는 어떤 값이 들어와도
 * 던지지 않는다 — 문자열이든 배열이든 `null`이든 각 칸을 따로 보고 기본값으로
 * 떨어질 뿐이다. 그것이 이 함수의 계약이고, 설정 한 줄이 깨졌다고 결제가
 * 멎는 일은 없어야 한다.
 */
export function normalizeFundingSettings(raw: unknown): FundingSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const hold = Number(r.hold_minutes)
  return {
    enabled: r.enabled === true,
    platform_fee_rate_member_bp: clampFeeRateBp(
      r.platform_fee_rate_member_bp,
      DEFAULTS.platform_fee_rate_member_bp
    ),
    platform_fee_rate_nonmember_bp: clampFeeRateBp(
      r.platform_fee_rate_nonmember_bp,
      DEFAULTS.platform_fee_rate_nonmember_bp
    ),
    hold_minutes:
      Number.isSafeInteger(hold) && hold >= 5 && hold <= 30 ? hold : DEFAULTS.hold_minutes,
  }
}

/** 승인 시점에 요율을 고르는 쪽이 쓰는 한 벌. */
export function feeRatesOf(settings: FundingSettings): FundingFeeRates {
  return {
    member_bp: settings.platform_fee_rate_member_bp,
    nonmember_bp: settings.platform_fee_rate_nonmember_bp,
  }
}

export async function getFundingSettings(): Promise<FundingSettings> {
  const settings = await getSystemSettings()
  return normalizeFundingSettings(settings?.features?.funding_features)
}

export async function isFundingEnabled(): Promise<boolean> {
  return (await getFundingSettings()).enabled
}
