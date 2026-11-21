/**
 * Content-Security-Policy 지시문의 단일 정본.
 *
 * next.config.js(CJS, 정적 백스톱 헤더)와 src/middleware/csp.ts(Edge, 요청별 헤더)가
 * 이 함수 하나로 같은 문자열을 만든다. 예전에는 두 파일에 손으로 복사해 두었다.
 * Node 전용 API를 쓰지 않는다(Edge 번들에 들어간다).
 *
 * 호스트를 더할 때는 여기 한 곳만 고친다. 빠진 호스트는 에러 없이 조용히 차단된다.
 */

const TOSS = 'https://*.tosspayments.com'
const TURNSTILE = 'https://challenges.cloudflare.com'
const BLOB_PUBLIC_HOST = 'https://r8qnr9c7mestxusj.public.blob.vercel-storage.com'

/** 신뢰 호스트 목록 — 테스트가 읽는다 */
const CSP_HOSTS = { TOSS, TURNSTILE, BLOB_PUBLIC_HOST }

/** report-uri 와 Reporting-Endpoints 가 같은 곳을 가리킨다 */
const CSP_REPORT_PATH = '/api/security/csp-report'
const CSP_REPORT_GROUP = 'csp-endpoint'

/**
 * @param {{ dev?: boolean, officeOrigin?: string, upgradeInsecure?: boolean }} [options]
 *   dev: 개발 서버(eval 기반 HMR·로컬 호스트 허용)
 *   officeOrigin: 이사회 업무툴 편집기 출처(검증된 origin, 없으면 빈 문자열)
 *   upgradeInsecure: upgrade-insecure-requests 지시문을 붙일지
 * @returns {string}
 */
function buildCsp(options) {
  const { dev = false, officeOrigin = '', upgradeInsecure = false } = options || {}
  const officeSrc = officeOrigin ? ` ${officeOrigin}` : ''
  const scriptHosts = `${TOSS} ${TURNSTILE}`

  return [
    "default-src 'self'",
    // dev: Next dev 런타임(eval 기반 HMR)이 죽지 않도록 'unsafe-eval'
    dev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${scriptHosts}`
      : `script-src 'self' 'unsafe-inline' ${scriptHosts}`,
    `script-src-elem 'self' 'unsafe-inline' ${scriptHosts}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // https: 유지 — 게시글 HTML(sanitizePostHtml)이 임의 https 호스트의 <img src>를 허용하고,
    // 사용자 입력 이미지 URL도 직접 렌더된다. 좁히면 외부 이미지가 조용히 깨진다.
    dev
      ? "img-src 'self' https: http://localhost:* http://127.0.0.1:* blob: data:"
      : "img-src 'self' https: blob: data:",
    // 프레스킷 음원 플레이어가 Blob에서 MP3를 직접 문다. 와일드카드 대신 우리 저장소 호스트만.
    dev
      ? `media-src 'self' http://localhost:* http://127.0.0.1:* https://www.youtube.com ${BLOB_PUBLIC_HOST}`
      : `media-src 'self' https://www.youtube.com ${BLOB_PUBLIC_HOST}`,
    // 토스 결제창·Turnstile 위젯·업무툴 편집기는 iframe
    `frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com ${TOSS} ${TURNSTILE}${officeSrc}`,
    // https://vercel.com: 업무툴 첨부의 브라우저 직접 업로드(@vercel/blob/client)
    dev
      ? `connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* ${TOSS} https://vercel.com`
      : `connect-src 'self' ${TOSS} https://vercel.com`,
    "object-src 'none'",
    "base-uri 'self'",
    // 결제창이 카드사 인증 페이지로 폼을 제출한다
    `form-action 'self' ${TOSS}`,
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
    ...(upgradeInsecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

/**
 * Reporting-Endpoints 헤더 값(Report-To 의 후속). 사이트 URL을 알면 절대 주소로 만든다.
 * @param {string} [siteUrl]
 */
function reportingEndpointsValue(siteUrl) {
  let base = ''
  try {
    base = siteUrl ? new URL(siteUrl).origin : ''
  } catch {
    base = ''
  }
  return `${CSP_REPORT_GROUP}="${base}${CSP_REPORT_PATH}"`
}

module.exports = { buildCsp, reportingEndpointsValue, CSP_HOSTS, CSP_REPORT_PATH, CSP_REPORT_GROUP }
