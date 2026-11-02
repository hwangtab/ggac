import { BOARD_WORK_HOME, BOARD_WORK_SEGMENTS } from '@/lib/boardWork/paths'

/**
 * 원본(kosmart-work) 경로 ↔ ggac 업무툴 경로 변환(순수) — 설계 §2-1.
 *
 * 원본 화면 코드는 앱이 사이트 루트에 있다고 보고 `/c/<slug>`·`/chat`·`/inbox`처럼 쓰고, `usePathname()`도
 * 그 모양으로 비교한다(`pathname.startsWith('/inbox')` 등). ggac에서는 같은 화면이 `/board-room` 아래에 있고,
 * 영어 로케일이면 그 앞에 `/en`이 붙는다. 옮긴 파일 수십 곳의 문자열을 고치는 대신 **경계에서 한 번만 바꾼다**:
 *   - 나가는 주소(`Link href`·`router.push`)  → `toWorkHref`  : `/inbox` → `/board-room/inbox`(+ `/en`)
 *   - 들어오는 경로(`usePathname()`)          → `fromWorkPathname`: `/en/board-room/inbox` → `/inbox`
 * 이 변환은 `@work/lib/nav/{link,navigation}`가 하고, 옮기기 스크립트가 `next/link`·`next/navigation` import를
 * 그리로 돌린다(scripts/work/port-from-kosmart.mjs `rewriteSpecifier`).
 *
 * 업무툴 섹션(BOARD_WORK_SEGMENTS)이 아닌 주소(`/login`·`/board-room`·`/api/…`·외부 URL)는 그대로 둔다.
 */

// ko는 기본 로케일이라 주소에 붙지 않지만(as-needed) 미들웨어 rewrite 뒤 서버 렌더에서 `/ko/…`로 보일 수 있어 함께 뗀다
const LOCALE_PREFIX = /^\/(en|ko)(?=\/|$|[?#])/
const SEGMENTS: ReadonlySet<string> = new Set(BOARD_WORK_SEGMENTS)
const WORK_BASE = '/board-room'

/** 경로의 로케일 접두사(`en`) — 기본 로케일(ko)은 접두사가 없어 null */
export function localeOfPathname(pathname: string | null | undefined): string | null {
  const locale = pathname ? LOCALE_PREFIX.exec(pathname)?.[1] : undefined
  return locale && locale !== 'ko' ? locale : null
}

function splitSuffix(href: string): [string, string] {
  const i = href.search(/[?#]/)
  return i === -1 ? [href, ''] : [href.slice(0, i), href.slice(i)]
}

/**
 * 원본 주소 → ggac 주소. `locale`은 지금 화면의 로케일 접두사(`localeOfPathname`) — 있으면 그대로 이어 붙인다.
 * - 원본 홈(`/`)은 업무툴 첫 화면(`/board-room/chat`)이다(ggac `/board-room`은 이사회실 대시보드라 겹치지 않게).
 * - 이미 `/board-room/…`인 주소(1a가 고친 `channelHref`·`messageLink`)는 접두사를 다시 붙이지 않는다.
 */
export function toWorkHref(href: string, locale: string | null = null): string {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href
  if (LOCALE_PREFIX.test(href)) return href
  const [path, suffix] = splitSuffix(href)
  let out = path
  if (path === '/' || path === '') out = BOARD_WORK_HOME
  else {
    const first = path.split('/')[1]
    if (SEGMENTS.has(first)) out = `${WORK_BASE}${path}`
  }
  const inWork = out === WORK_BASE || out.startsWith(`${WORK_BASE}/`)
  return `${locale && inWork ? `/${locale}` : ''}${out}${suffix}`
}

/**
 * ggac 경로 → 원본 경로(`usePathname` 결과를 원본 비교식에 넘길 때). 업무툴 밖이면 그대로 둔다.
 * `/board-room/chat`은 원본 `/chat`이다(원본 홈 `/`과는 구분하지 않는다 — 레일에서 채팅 섹션으로 보인다).
 */
export function fromWorkPathname(pathname: string | null | undefined): string | null {
  if (pathname == null) return pathname ?? null
  const path = pathname.replace(LOCALE_PREFIX, '') || '/'
  const m = /^\/board-room(\/[^/?#]+)(.*)$/.exec(path)
  if (m && SEGMENTS.has(m[1].slice(1))) return `${m[1]}${m[2]}`
  return path
}
