/**
 * 배포 직후 낡은 탭의 서버 액션 실패 판별.
 *
 * Next 15 는 서버 액션 id 를 빌드마다 바꾼다. 배포 전에 열어 둔 탭이 옛 id 로 액션을 부르면 서버가
 * 모르는 액션이라 하고, 클라이언트는 `UnrecognizedActionError`
 * ('Server Action "<id>" was not found on the server …')를 던진다. 재시도해도 낫지 않고 새로고침만 낫는다.
 * 코드 조각(chunk) 로드 실패와 같은 뿌리라 같은 표식(sessionStorage 60초, `ops/chunk-reload`)으로 루프를 막는다.
 */
import { claimChunkReload, reloadPage } from '@work/lib/ops/chunk-reload'

export function isStaleActionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: unknown }).name ?? '')
  const message = String((error as { message?: unknown }).message ?? '')
  return (
    name === 'UnrecognizedActionError' ||
    /Server Action .* was not found on the server/i.test(message)
  )
}

/**
 * 사용자가 쓰던 글이 있는가(비어 있지 않은 입력칸). 자동 새로고침이 입력을 날리지 않게 한다.
 * 글 자체는 localStorage 임시 저장에 있지만, 첨부 대기·인용·수정 중인 글은 저장되지 않는다.
 */
export function isUserBusyEditing(doc: Document = document): boolean {
  const fields = doc.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
    'textarea, input[type="text"], input[type="search"], input:not([type])'
  )
  for (const f of fields) if (f.value.trim().length > 0) return true
  const active = doc.activeElement
  return active instanceof HTMLElement && active.isContentEditable && !!active.textContent?.trim()
}

/**
 * 낡은 탭이면 자동 새로고침. 새로고침했으면 true.
 * 입력 중이거나 최근 60초 안에 이미 새로고침했으면 하지 않는다(화면 안내로 맡긴다).
 */
export function reloadIfIdle(opts: { busy?: boolean } = {}): boolean {
  if (typeof window === 'undefined') return false
  if (opts.busy || isUserBusyEditing()) return false
  try {
    if (!claimChunkReload(window.sessionStorage, Date.now())) return false
  } catch {
    return false
  }
  reloadPage()
  return true
}
