import type { BrowserContext } from '@playwright/test'

/**
 * 편집기 사이트(`NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN` — 배포된 ggac-office)의 `frame-ancestors`는 운영 주소와 로컬 E2E
 * 포트 둘(3000·3101)만 허용한다(2026-11-05 실측: `http://127.0.0.1:3101` 등). 다른 포트(`PLAYWRIGHT_PORT=3103` —
 * 3101 에서 도는 다른 E2E 와 겹치지 않게)로 돌리면 브라우저가 편집기 iframe 을 막아, 앱 코드와 무관하게 실제 편집기
 * 스펙이 전부 "편집기를 불러오는 중"에 멈춘다.
 *
 * 그때만 **편집기 출처의 문서 응답**에서 `frame-ancestors` 지시어 하나를 걷어 낸다(시험 브라우저 안에서만 — 편집기 사이트와
 * 앱 코드는 그대로다). 운영에서 ggac.kr 이 허용 목록에 있는 것과 같은 조건을 만든다. 다른 CSP 지시어·스크립트·wasm 요청은
 * 건드리지 않는다. 허용 포트(3000·3101)에서는 아무것도 하지 않는다 — 실제 헤더 그대로 돈다.
 */
const ALLOWED_PORTS = new Set(['3000', '3101'])

function editorOriginNeedingShim(): string | null {
  const origin = process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN?.trim()
  const port = String(process.env.PLAYWRIGHT_PORT || 3101)
  if (!origin || ALLOWED_PORTS.has(port)) return null
  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}

/**
 * 컨텍스트를 만들 때 함께 넘길 옵션. 걷어 내기가 필요할 때만 서비스 워커를 막는다 — 편집기 사이트의 `sw.js`(캐시 전용)가
 * 내부 iframe 문서를 대신 내주면 Playwright 의 route 가 그 응답을 보지 못해 frame-ancestors 가 그대로 남는다
 * (2026-11-05 실측: 바깥 편집기는 열리고 문서를 연 뒤의 안쪽 프레임만 막혔다). 허용 포트에서는 빈 옵션이다.
 */
export function editorFramingOptions(): { serviceWorkers?: 'block' } {
  return editorOriginNeedingShim() ? { serviceWorkers: 'block' } : {}
}

export async function allowEditorFraming(context: BrowserContext): Promise<void> {
  const editorOrigin = editorOriginNeedingShim()
  if (!editorOrigin) return
  await context.route(
    url => url.origin === editorOrigin,
    async route => {
      const request = route.request()
      if (request.resourceType() !== 'document') return route.continue()
      const response = await route.fetch()
      const headers = { ...response.headers() }
      const csp = headers['content-security-policy']
      if (csp) {
        headers['content-security-policy'] = csp
          .split(';')
          .map(d => d.trim())
          .filter(d => d && !/^frame-ancestors\b/i.test(d))
          .join('; ')
      }
      await route.fulfill({ response, headers })
    }
  )
}
