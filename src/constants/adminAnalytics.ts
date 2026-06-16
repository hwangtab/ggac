export const TREND_PERIODS = ['daily', 'weekly', 'monthly'] as const
export type TrendPeriod = (typeof TREND_PERIODS)[number]

export const TREND_TYPES = ['activity', 'users', 'engagement', 'performance'] as const
export type TrendType = (typeof TREND_TYPES)[number]

export const PERFORMANCE_ACTIONS = ['dashboard', 'endpoint', 'health', 'export'] as const
export type PerformanceAction = (typeof PERFORMANCE_ACTIONS)[number]

export function parseTrendPeriod(value: unknown): TrendPeriod | null {
  return typeof value === 'string' && TREND_PERIODS.includes(value as TrendPeriod)
    ? (value as TrendPeriod)
    : null
}

export function parseTrendType(value: unknown): TrendType | null {
  return typeof value === 'string' && TREND_TYPES.includes(value as TrendType)
    ? (value as TrendType)
    : null
}

export function parsePerformanceAction(value: unknown): PerformanceAction | null {
  return typeof value === 'string' && PERFORMANCE_ACTIONS.includes(value as PerformanceAction)
    ? (value as PerformanceAction)
    : null
}
