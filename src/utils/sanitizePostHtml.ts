import sanitizeHtml from 'sanitize-html'

/**
 * 게시글 본문(HTML) 서버·클라 공용 sanitizer.
 *
 * 기존 isomorphic-dompurify(→ jsdom) 대신 sanitize-html(htmlparser2 기반 순수 JS)을 사용한다.
 * jsdom을 전혀 거치지 않으므로 Vercel 서버리스 런타임에서 SSR 중
 * `ERR_REQUIRE_ESM`(jsdom → html-encoding-sniffer → @exodus/bytes)으로 throw 하지 않는다.
 *
 * 보안 태세는 기존 DOMPurify 설정과 동등 이상으로 엄격하게 유지한다.
 * 아래 설정은 PostContentRenderer의 DOMPurify 설정을 충실히 이식한 것이다.
 *
 * DOMPurify → sanitize-html 매핑:
 * - ALLOWED_TAGS               → allowedTags (동일 목록)
 * - ALLOWED_ATTR + ADD_ATTR    → allowedAttributes (href/target=a, src/alt/width/height=img,
 *                                class/title/data-list/data-indent/data-checked=* 로 더 엄격히 스코프)
 * - ALLOWED_URI_REGEXP         → allowedSchemes + allowProtocolRelative
 * - KEEP_CONTENT: true         → disallowedTagsMode: 'discard' (허용 안 된 태그 제거·텍스트 보존)
 * - FORBID_TAGS/FORBID_ATTR    → allowlist에서 자동 배제(스크립트/스타일 등은 nonTextTags로 내용까지 제거)
 * - ALLOW_ARIA_ATTR: false     → aria-* 미허용(allowlist에 없음)
 * - ALLOW_DATA_ATTR: true      → data-* 중 Quill용 3개만 허용(더 엄격)
 * - ALLOW_UNKNOWN_PROTOCOLS: false → allowedSchemes 외 스킴 차단
 */
export function sanitizePostHtml(html: string): string {
  if (typeof html !== 'string') {
    return ''
  }

  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'div',
      'span',
    ],
    allowedAttributes: {
      '*': ['class', 'title', 'data-list', 'data-indent', 'data-checked'],
      a: ['href', 'target'],
      img: ['src', 'alt', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel', 'callto', 'sms'],
    allowProtocolRelative: true,
    // 허용되지 않은 태그는 제거하되 텍스트 내용은 보존(DOMPurify KEEP_CONTENT 대응).
    // script/style/textarea/option 등 nonTextTags의 내부 내용은 기본값대로 함께 제거된다.
    disallowedTagsMode: 'discard',
  })
}

export default sanitizePostHtml
