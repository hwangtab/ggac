const RESERVED_NOTIFICATION_DATA_KEYS = new Set(['post_id', 'related_post_id', 'related_user_id'])
const MAX_NOTIFICATION_DATA_DEPTH = 3
const MAX_NOTIFICATION_DATA_KEYS = 20
const MAX_NOTIFICATION_DATA_ARRAY_LENGTH = 20
const MAX_NOTIFICATION_DATA_STRING_LENGTH = 500

function sanitizeNotificationDataValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_NOTIFICATION_DATA_STRING_LENGTH)
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_NOTIFICATION_DATA_DEPTH) return []
    return value
      .slice(0, MAX_NOTIFICATION_DATA_ARRAY_LENGTH)
      .map(item => sanitizeNotificationDataValue(item, depth + 1))
  }

  if (typeof value === 'object' && value) {
    if (depth >= MAX_NOTIFICATION_DATA_DEPTH) return {}

    const sanitized: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_NOTIFICATION_DATA_KEYS
    )

    for (const [key, nestedValue] of entries) {
      if (!key || RESERVED_NOTIFICATION_DATA_KEYS.has(key)) continue
      sanitized[key] = sanitizeNotificationDataValue(nestedValue, depth + 1)
    }

    return sanitized
  }

  return null
}

export function sanitizeNotificationData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return sanitizeNotificationDataValue(value, 0) as Record<string, unknown>
}
