import { validateUUID } from '@/utils/validation'

export interface TimestampUuidCursor {
  createdAt: string
  id: string
}

export function parseTimestampUuidCursor(
  cursor: string,
  idLabel: string = 'ID'
): TimestampUuidCursor | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(cursor)
  } catch {
    return null
  }

  const parts = decoded.split('|')
  if (parts.length !== 2) return null

  const createdAt = parts[0]
  const timestampLooksSafe = /^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(createdAt)
  if (!timestampLooksSafe || !Number.isFinite(Date.parse(createdAt))) return null

  const idValidation = validateUUID(parts[1] ?? '', idLabel)
  if (!idValidation.isValid) return null

  return { createdAt, id: idValidation.sanitized }
}

export function formatTimestampUuidCursor(createdAt: string, id: string): string {
  return encodeURIComponent(`${createdAt}|${id}`)
}
