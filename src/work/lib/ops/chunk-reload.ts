/**
 * 배포 뒤 낡은 탭의 화면 코드 조각(chunk) 로드 실패 처리.
 *
 * 새 배포가 올라가면 이전 배포의 `/_next/static/chunks/*` 가 사라져, 배포 전에 열어 둔 탭이 화면을 옮길 때
 * `ChunkLoadError` 가 난다. "다시 시도"(reset)로는 낫지 않고 전체 새로고침만이 새 코드를 받는다.
 * 그래서 오류 화면이 한 번만 자동 새로고침한다 — 같은 탭에서 짧은 시간에 되풀이되면(새 배포에도 조각이 없는 경우)
 * 무한 새로고침을 막으려고 sessionStorage 표식으로 1분에 한 번으로 제한한다.
 */

export const CHUNK_RELOAD_KEY = 'kw-chunk-reload-at'
const CHUNK_RELOAD_WINDOW_MS = 60_000

/** 화면 코드 조각 로드 실패인가(webpack·브라우저 dynamic import·CSS 조각) */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: unknown }).name ?? '')
  const message = String((error as { message?: unknown }).message ?? '')
  if (name === 'ChunkLoadError') return true
  return (
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  )
}

/**
 * 자동 새로고침을 해도 되는가. 해도 되면 표식을 남기고 true.
 * storage 접근이 막힌 환경(사생활 보호 모드 등)에서는 루프 위험이 있어 false.
 */
export function claimChunkReload(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number
): boolean {
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** 전체 새로고침(테스트에서 바꿔 끼울 수 있게 함수로 둔다) */
export function reloadPage(): void {
  window.location.reload()
}
