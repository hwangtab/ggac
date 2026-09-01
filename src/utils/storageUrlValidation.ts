/**
 * 스토리지 객체의 **논리 경로**(`<prefix>/<key>`, 버킷 상대)가 안전한 형태인지만
 * 본다. 절대 URL 판정은 여기 없다 — 그 일은 `@/lib/storage/paths`의
 * `logicalPathFromUrl`이 버킷·접두사까지 함께 봉쇄하며 담당한다.
 *
 * 예전에는 이 모듈이 NEXT_PUBLIC_SUPABASE_URL과 origin을 대조하는
 * `getProjectStorageObjectPath`/`isProjectStoragePublicUrl`도 함께 들고 있었다.
 * Supabase 프로젝트가 2026-09-01에 삭제됐고 DB에 남은 Supabase 절대 URL이
 * 0건임을 실측해 그 두 판정을 지웠다 — 남겨두면 항상 false를 돌려주는 죽은
 * 가지가 되어 "검증하고 있다"는 착시만 준다.
 */
export function isProjectStorageObjectPath(value: string, pathPrefix = ''): boolean {
  if (typeof value !== 'string') return false

  const trimmed = value.trim()
  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed !== value || /[\u0000-\u001f\u007f\\]/.test(trimmed)) return false
  if (trimmed.startsWith('/') || trimmed.split('/').some(segment => segment === '..')) return false

  return normalizedPrefix ? trimmed.startsWith(`${normalizedPrefix}/`) : true
}
