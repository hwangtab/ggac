import { logicalPathFromUrl } from '@/lib/storage/paths'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'

export const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

export function normalizeEventSlug(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidEventSlug(value: string): boolean {
  return EVENT_SLUG_PATTERN.test(normalizeEventSlug(value))
}

export function isValidEventApplicationPhotoUrl(value: string): boolean {
  return (
    isProjectStoragePublicUrl(value, 'attachments', 'event-applications') ||
    logicalPathFromUrl(value, 'attachments', 'event-applications') !== null
  )
}
