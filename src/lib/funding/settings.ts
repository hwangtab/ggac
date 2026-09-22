import { getSystemSettings } from '@/utils/systemSettings'

export interface FundingSettings {
  enabled: boolean
  platform_fee_rate_bp: number
  hold_minutes: number
}

const DEFAULTS: FundingSettings = { enabled: false, platform_fee_rate_bp: 0, hold_minutes: 10 }

/** 관리자 화면에서 무엇을 넣든 여기서 범위를 지킨다. 수수료율은 만분율 0~3000. */
export function normalizeFundingSettings(raw: unknown): FundingSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const fee = Number(r.platform_fee_rate_bp)
  const hold = Number(r.hold_minutes)
  return {
    enabled: r.enabled === true,
    platform_fee_rate_bp:
      Number.isSafeInteger(fee) && fee >= 0 && fee <= 3000 ? fee : DEFAULTS.platform_fee_rate_bp,
    hold_minutes:
      Number.isSafeInteger(hold) && hold >= 5 && hold <= 30 ? hold : DEFAULTS.hold_minutes,
  }
}

export async function getFundingSettings(): Promise<FundingSettings> {
  const settings = await getSystemSettings()
  return normalizeFundingSettings(settings?.features?.funding_features)
}

export async function isFundingEnabled(): Promise<boolean> {
  return (await getFundingSettings()).enabled
}
