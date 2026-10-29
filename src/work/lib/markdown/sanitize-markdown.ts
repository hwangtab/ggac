/**
 * 사용자 입력 마크다운의 저장 단계 정제.
 *
 * 원칙: 저장 단계는 **마크다운 링크 스킴만 무력화**하고 원문을 그대로 둔다.
 * HTML 방어는 출력 단계에서 한다.
 *  - 화면: react-markdown(raw HTML 비렌더, rehype-raw 금지) + defaultUrlTransform·isSafeHref allowlist
 *  - 메일: 본문을 HTML 로 내보내는 소비처를 만들면 그 출력 단계에서 sanitize 한다
 *
 * 마크다운 원문에 sanitize-html을 돌리면 안 된다. HTML 도구라 줄머리 인용 `>`를 `&gt;`로,
 * 코드 안 `&`·`<`를 엔티티로 바꾸고, `a <b 보다` 같은 텍스트를 태그로 오인해 지운다.
 * 그 결과 인용이 깨지고, 엔티티 뒤의 `**`가 닫히지 못해 리터럴로 새며, 다시 저장할 때마다
 * `&amp;gt;`로 누적 손상됐다. 이 함수는 멱등이어야 한다 — sanitize(sanitize(x)) === sanitize(x).
 */

// 마크다운 링크/이미지 `](url)`·`![](url)` 와 참조정의 `[id]: url` 의 위험 스킴을 무력화.
const MD_LINK_DANGEROUS_SCHEME = /(\]\(\s*<?|\]:\s+<?)(?:javascript|data|vbscript|file):/gi

export function sanitizeUserMarkdown(markdown: string): string {
  // 무력화 결과(`#`)가 다시 패턴을 만들 수 없으므로 고정점까지 돌릴 필요가 없다
  // (`](javascript:javascript:x)` → `](#javascript:x)`는 `](` 바로 뒤가 `#`라 재매치 없음).
  return markdown.replace(MD_LINK_DANGEROUS_SCHEME, '$1#')
}
