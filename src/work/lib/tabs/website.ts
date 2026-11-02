/**
 * 웹사이트 탭 표시 방식(순수, docs/05 §4-2).
 * - **탭 안 표시(iframe)는 허용 목록만**(docs/07 S-4): 구글 문서·시트·슬라이드·설문, 구글 캘린더 임베드, 구글 드라이브 파일.
 *   주소는 임베드 형태로 바꿔 준다. 그 밖의 주소는 모두 카드("새 창에서 열기") — 업무 시스템 화면 안에 아무 사이트(로그인 피싱 등)가
 *   뜨지 않게. CSP frame-src 도 같은 목록(`EMBED_FRAME_ORIGINS`, security-headers.ts)이라 둘이 어긋나면 iframe 이 막힌다.
 * - kosmart.org 계열(같은 쿠키 도메인 — 클릭재킹·세션 혼동 방지)은 카드로만 보인다.
 * (의존성 없는 순수 모듈 — next.config.ts → security-headers.ts 가 상대 경로로 불러온다.)
 *
 * ggac 이식(2b): ggac의 CSP(`next.config.js`·`src/middleware/csp.ts`)는 frame-src에 아래 출처를 열지 않았다.
 * 사이트 전체 보안 정책이라 이 이식에서 넓히지 않고, 탭 안 표시를 끈다(`EMBED_ALLOWED_BY_CSP`). 켜려면 두 곳의
 * frame-src에 `EMBED_FRAME_ORIGINS`를 더하고 이 값을 true로 바꾼다. 같은 사이트 판정에 ggac.kr를 더했다.
 */

/** CSP frame-src가 EMBED_FRAME_ORIGINS를 허용하는가 — ggac는 아직 아니다 */
export const EMBED_ALLOWED_BY_CSP = false

/**
 * 웹사이트 탭 iframe 이 열 수 있는 출처(CSP frame-src 에 그대로 들어간다).
 * accounts.google.com 은 탭으로 직접 띄우지 않지만, 구글 임베드가 로그인 확인으로 잠깐 거쳐 가는 경우가 있어 둔다.
 */
export const EMBED_FRAME_ORIGINS = [
  'https://docs.google.com',
  'https://calendar.google.com',
  'https://drive.google.com',
  'https://accounts.google.com',
] as const

export type WebsiteDisplay =
  | { mode: 'embed'; src: string }
  | {
      mode: 'card'
      reason: 'disabled' | 'same-site' | 'not-allowed' | 'invalid' | 'not-embeddable'
    }

/** 호스트 비교용 정규화: 소문자 + 끝의 `.` 제거(`kosmart.org.` 로 같은 사이트 판정을 피하는 우회 차단) */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '')
}

/** 감사 기록 등에 남길 호스트(경로·쿼리·토큰은 남기지 않는다). 주소가 아니면 null */
export function websiteHost(raw: string): string | null {
  try {
    return normalizeHost(new URL(raw).hostname)
  } catch {
    return null
  }
}

/** kosmart.org 와 그 하위 도메인 — ggac 이식: ggac.kr(이 사이트, 같은 쿠키 도메인)도 같은 사이트로 본다 */
export function isKosmartHost(hostname: string): boolean {
  const h = normalizeHost(hostname)
  return (
    h === 'kosmart.org' || h.endsWith('.kosmart.org') || h === 'ggac.kr' || h.endsWith('.ggac.kr')
  )
}

/** 구글 문서류·캘린더·드라이브 주소 → 임베드 주소. 허용 목록 밖이거나 임베드할 수 없는 모양이면 null */
export function googleEmbedUrl(url: URL): string | null {
  const host = normalizeHost(url.hostname)
  if (host === 'calendar.google.com') {
    // 캘린더는 공유 설정의 "삽입 코드" 주소(/calendar/embed?src=…)만 iframe 을 허용한다
    return url.pathname === '/calendar/embed'
      ? `https://calendar.google.com${url.pathname}${url.search}`
      : null
  }
  if (host === 'drive.google.com') {
    const f = /^\/file\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)
    return f ? `https://drive.google.com/file/d/${f[1]}/preview` : null
  }
  if (host !== 'docs.google.com') return null
  const form = /^\/forms\/d\/e\/([A-Za-z0-9_-]+)/.exec(url.pathname)
  if (form) return `https://docs.google.com/forms/d/e/${form[1]}/viewform?embedded=true`
  const m = /^\/(spreadsheets|document|presentation)\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)
  if (!m) return null
  const [, type, id] = m
  const base = `https://docs.google.com/${type}/d/${id}`
  if (type === 'presentation') return `${base}/embed`
  const out = new URL(`${base}/edit`)
  out.searchParams.set('rm', 'minimal')
  const gid = url.searchParams.get('gid') ?? /gid=(\d+)/.exec(url.hash)?.[1]
  if (type === 'spreadsheets' && gid && /^\d+$/.test(gid)) out.searchParams.set('gid', gid)
  return out.toString()
}

export function websiteDisplay(config: { url: string; embed: boolean }): WebsiteDisplay {
  let url: URL
  try {
    url = new URL(config.url)
  } catch {
    return { mode: 'card', reason: 'invalid' }
  }
  if (url.protocol !== 'https:') return { mode: 'card', reason: 'invalid' }
  if (isKosmartHost(url.hostname)) return { mode: 'card', reason: 'same-site' }
  const src = googleEmbedUrl(url)
  if (!src) return { mode: 'card', reason: 'not-allowed' }
  if (!config.embed) return { mode: 'card', reason: 'disabled' }
  return EMBED_ALLOWED_BY_CSP ? { mode: 'embed', src } : { mode: 'card', reason: 'not-embeddable' }
}

/** 탭 이름 기본값 제안: 호스트(www. 제거) */
export function suggestWebsiteTitle(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, '').slice(0, 40)
  } catch {
    return ''
  }
}
