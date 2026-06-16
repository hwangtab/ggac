export function parseNotificationExpiresAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return undefined

  const expiresAt = parsed.toISOString()
  return parsed.getTime() > Date.now() ? expiresAt : undefined
}
