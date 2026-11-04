/**
 * 메일함 화면들이 공유하는 순수 헬퍼 — 포맷, 본문 iframe `srcDoc` 조립, 원격 이미지 가드.
 *
 * 받은 메일(`MailboxView`)과 보낸 메일(`SentMailbox`)이 같은 규칙으로 본문을 그린다. 본문은 항상 sandbox
 * iframe에 넣고, 여기서 만드는 `srcDoc`이 CSP 메타로 원격 이미지를 막는다.
 */

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 받은 메일 본문을 iframe에 넣을 srcDoc을 만든다.
 *
 * 수신 본문 경로에는 정화(sanitize)가 없다 — `sanitizePostHtml`은 답장
 * 발신 경로에서만 쓰인다. 실제 방어는 sandbox 하나뿐이지만 그것으로
 * 충분하다 — `allow-scripts`를 주지 않아 스크립트를 아예 못 돌린다
 * (`allow-popups`는 새 탭을 여는 것만 허용할 뿐 실행 권한이 아니다).
 * 다만 sandbox는 서브리소스 로드는
 * 막지 않으므로, 본문에 박힌 원격 `<img>`(추적 픽셀)가 그대로 요청돼
 * 열람자의 IP와 "읽었다는 사실"을 발신자에게 알릴 수 있다. 문서 맨 앞에
 * CSP 메타로 `img-src`를 `data:` + **우리 출처**(ggac.kr, 공개 Blob,
 * YouTube 썸네일)로 한정해 그 밖의 원격 이미지를 막는다 — 첨부로 붙은
 * 인라인 이미지는 `html_format=data_uri`로 이미 base64로 박혀 있으므로
 * 그대로 보이고, 우리가 보낸 메일이 인용돼 돌아온 경우(프레스킷 아트워크·
 * 앨범 썸네일)도 깨지지 않는다. 그 외 출처는 관리자가 메일별로
 * "이미지 표시"를 눌렀을 때만(`showRemoteImages`) `https:` 전체로 연다 —
 * 발신자에게 열람 사실을 알리는 것은 그때뿐이다.
 *
 * `body_html`이 없고 `body_text`만 있으면(순수 텍스트 메일 —
 * `body_fetch_status`는 이미 'done'이라 배지가 뜨지 않는다) 그것을
 * `<pre>`로 보여준다. HTML로 해석되면 안 되므로 반드시 이스케이프한다.
 *
 * 본문 문서는 관리자 화면의 다크 테마와 무관하게 **항상 밝은 바탕**이다.
 * 메일 HTML은 대개 `<body>`도 배경 지정도 없이 검은 글씨만 전제하므로,
 * iframe 문서가 부모의 `color-scheme: dark`를 물려받으면 검정 위에 검정이
 * 된다(2026-09-09 실제 메일로 확인). `color-scheme` 메타와 인라인 스타일로
 * 고정한다 — 둘 다 위 CSP(`style-src 'unsafe-inline'`)가 허용한다.
 */
const TRUSTED_IMAGE_ORIGINS = [
  'https://ggac.kr',
  'https://www.ggac.kr',
  'https://img.youtube.com',
  'https://i.ytimg.com',
  // NEXT_PUBLIC_ 접두사라 빌드 시 클라이언트 번들에 박힌다. 비어 있으면 빠진다.
  (process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
]
  .filter(origin => /^https:\/\/[^\s'";]+$/.test(origin))
  .join(' ')

function remoteImageGuardMeta(showRemoteImages: boolean): string {
  const imgSrc = showRemoteImages ? 'data: https:' : `data: ${TRUSTED_IMAGE_ORIGINS}`
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'">`
}

/** 본문에 우리 출처가 아닌 원격 이미지가 있는가 — "이미지 표시" 버튼을 띄울지 판정. */
export function hasUntrustedRemoteImage(bodyHtml: string | null | undefined): boolean {
  if (!bodyHtml) return false
  const trusted = TRUSTED_IMAGE_ORIGINS.split(' ')
  for (const match of bodyHtml.matchAll(
    /<img\b[^>]*?\ssrc\s*=\s*["']?\s*(https?:\/\/[^"'\s>]+)/gi
  )) {
    let origin: string
    try {
      origin = new URL(match[1]).origin
    } catch {
      return true
    }
    if (!trusted.includes(origin)) return true
  }
  return false
}
const LIGHT_CANVAS =
  '<meta name="color-scheme" content="light only">' +
  '<style>html,body{background:#fff;color:#111827;margin:0;padding:8px}</style>'

/**
 * 본문 안의 링크는 **새 탭**으로 연다.
 *
 * iframe은 `sandbox`에 `allow-popups`만 더해 두었다(스크립트는 여전히 금지).
 * 그래서 iframe 자신을 이동시키는 링크는 막히고 새 창만 열리므로, 모든
 * 앵커에 `target="_blank"`가 붙어 있어야 클릭이 먹는다. 메일 HTML은 target을
 * 안 붙이는 경우가 많아 `<base>`로 기본값을 준다.
 *
 * `rel`은 `<base>`로 줄 수 없어 앵커마다 직접 박는다. `noopener`가 없으면
 * 열린 페이지가 `window.opener`로 본문 프레임을 다른 주소로 바꿔치기할 수
 * 있고(역탭내빙), `noreferrer`는 어느 메일을 열었는지가 참조 주소로 새어
 * 나가는 것을 막는다. 발신자가 `rel="nofollow"` 같은 값을 이미 붙여 둔
 * 앵커는 **건너뛰지 않고 그 값에 덧붙인다** — 건너뛰면 메일 쪽에서 rel을
 * 하나 넣는 것만으로 보호를 벗겨낼 수 있다.
 */
const LINK_TARGET_BASE = '<base target="_blank">'

function hardenLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (tag, attrs: string) => {
    const relPattern = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    const found = attrs.match(relPattern)
    if (!found) return `<a${attrs} rel="noopener noreferrer">`
    const existing = (found[1] ?? found[2] ?? found[3] ?? '').trim()
    const merged = [
      ...new Set([...existing.split(/\s+/).filter(Boolean), 'noopener', 'noreferrer']),
    ]
    return `<a${attrs.replace(relPattern, '')} rel="${merged.join(' ')}">`
  })
}
type BodyDoc = { body_html?: string | null; body_text?: string | null }

export function buildBodySrcDoc(detail: BodyDoc | null, showRemoteImages: boolean = false): string {
  const BODY_DOC_HEAD = remoteImageGuardMeta(showRemoteImages) + LIGHT_CANVAS + LINK_TARGET_BASE
  if (detail?.body_html) {
    return `${BODY_DOC_HEAD}${hardenLinks(detail.body_html)}`
  }
  if (detail?.body_text) {
    return `${BODY_DOC_HEAD}<pre style="font-family:sans-serif;white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtml(detail.body_text)}</pre>`
  }
  return `${BODY_DOC_HEAD}<p style="font-family:sans-serif;color:#6b7280">본문이 아직 도착하지 않았습니다.</p>`
}
