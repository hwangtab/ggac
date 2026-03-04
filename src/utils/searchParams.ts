/**
 * URL searchParams에서 단일 문자열 값을 추출하는 유틸리티
 * Next.js searchParams는 string | string[] | undefined 타입
 */
export function normalizeSingleParam(value?: string | string[] | null): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}
