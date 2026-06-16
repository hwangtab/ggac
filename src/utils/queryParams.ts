export function parseIntegerParam(
  value: string | null,
  fallback: number,
  options: { min?: number; max?: number } = {}
): number {
  const normalized = value?.trim() ?? ''
  const parsed = /^[+-]?\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN
  const min = options.min ?? Number.NEGATIVE_INFINITY
  const max = options.max ?? Number.POSITIVE_INFINITY
  const number = Number.isFinite(parsed) ? parsed : fallback

  return Math.min(max, Math.max(min, number))
}
