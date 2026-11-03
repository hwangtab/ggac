import { getOfficeEditorOrigin, OFFICE_PURGE_WAIT_MS } from './office-edit'

/**
 * 로그아웃 때 편집기 출처의 분할 저장소를 지운다(docs/11 §1·§2-3): `${ORIGIN}/purge.html`(Clear-Site-Data)을 숨은 iframe 으로 한 번 불러
 * 로드가 끝나거나 최대 3초가 지나면 진행한다. env 가 없으면 아무것도 하지 않는다. 던지지 않는다.
 */
export function purgeOfficeEditorStorage(waitMs: number = OFFICE_PURGE_WAIT_MS): Promise<void> {
  const origin = getOfficeEditorOrigin()
  if (!origin || typeof document === 'undefined') return Promise.resolve()
  return new Promise<void>(resolve => {
    let done = false
    const frame = document.createElement('iframe')
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      frame.remove()
      resolve()
    }
    const timer = window.setTimeout(finish, waitMs)
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.referrerPolicy = 'no-referrer'
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
    frame.addEventListener('load', finish)
    frame.addEventListener('error', finish)
    frame.src = `${origin}/purge.html`
    document.body.appendChild(frame)
  })
}
