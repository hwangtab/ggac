/**
 * 미들웨어가 **그냥 통과시키는** 정적 자원 판정(2026-11-09 사각지대 점검).
 *
 * 왜: 예전 조건은 `pathname.includes('.')` 였다 — **점이 하나라도 있으면** 인증·CSP·intl 을
 * 전부 건너뛰었다. 지금은 동적 관리자 페이지가 없어 실노출이 낮지만, 경로에 점이 들어갈 수 있는
 * 화면이 하나 생기는 순간 그 화면은 인증 바깥에 놓인다. "정적 자원 목록"으로 좁힌다.
 *
 * 판정은 **파일 이름의 확장자**와 **루트의 정적 파일**만 본다. 그래서 `/admin/grants/2026.11`
 * 같은 경로는 (점이 있어도) 확장자 목록에 없으므로 정적 자원이 아니고, 미들웨어가 인증·CSP 를
 * 그대로 적용한다.
 *
 * 목록은 `public/` 에 실제로 있는 확장자(webp·jpg·png·jpeg·js·xlsx·txt·svg·pptx·ico·hwpx·docx·avif)
 * 를 모두 덮고, 그 밖에 프레임워크·브라우저가 흔히 요청하는 것(css·map·json·xml·webmanifest·
 * 폰트·미디어·문서·압축)을 더한다. **여기에 없는 확장자는 정적 자원이 아니다** — 모르면
 * 미들웨어를 태우는 쪽(안전한 쪽)으로 틀린다.
 *
 * `next.config.js` 의 정적 CSP 는 미들웨어를 거치지 않는 경로의 백스톱이다. 이 판정이 좁아져도
 * 그 백스톱은 그대로 있고, 오히려 미들웨어를 타는 경로가 늘어 CSP 주입이 늘어난다.
 */

/** 정적 자원으로 인정하는 확장자(소문자 비교). */
export const STATIC_ASSET_EXTENSIONS = [
  // public/ 에 실제로 있는 것
  'webp',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'svg',
  'ico',
  'avif',
  'js',
  'mjs',
  'txt',
  'xlsx',
  'pptx',
  'docx',
  'hwpx',
  // 흔한 정적 자원
  'css',
  'map',
  'json',
  'xml',
  'webmanifest',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'bmp',
  'mp3',
  'wav',
  'ogg',
  'mp4',
  'webm',
  'pdf',
  'zip',
  'hwp',
  'doc',
  'xls',
  'ppt',
] as const

/** 루트에 놓이는 정적 파일(확장자 판정만으로는 빠지는 것들). */
export const STATIC_ROOT_FILES = [
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/llms.txt',
] as const

const STATIC_EXTENSION_PATTERN = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS.join('|')})$`, 'i')

const ROOT_FILE_SET: ReadonlySet<string> = new Set(STATIC_ROOT_FILES)

/**
 * 정적 자원 요청인가 — true 면 미들웨어가 인증·CSP·intl 없이 통과시킨다.
 * 쿼리스트링은 호출부가 떼고 넘긴다(`request.nextUrl.pathname`).
 */
export function isStaticAssetPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false
  // Next.js 내부 산출물(청크·이미지 최적화·HMR)
  if (pathname.startsWith('/_next/')) return true
  if (ROOT_FILE_SET.has(pathname)) return true
  return STATIC_EXTENSION_PATTERN.test(pathname)
}
