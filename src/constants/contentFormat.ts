export const CONTENT_FORMATS = ['plain', 'html', 'markdown'] as const

export type ContentFormat = (typeof CONTENT_FORMATS)[number]

export function parseContentFormat(value: unknown): ContentFormat | null {
  if (typeof value !== 'string') return null
  return CONTENT_FORMATS.some(format => format === value) ? (value as ContentFormat) : null
}
