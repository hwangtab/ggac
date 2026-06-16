export const EVENT_APPLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const

export type EventApplicationStatus = (typeof EVENT_APPLICATION_STATUSES)[number]

export function parseEventApplicationStatus(value: unknown): EventApplicationStatus | null {
  if (typeof value !== 'string') return null

  return EVENT_APPLICATION_STATUSES.includes(value as EventApplicationStatus)
    ? (value as EventApplicationStatus)
    : null
}
