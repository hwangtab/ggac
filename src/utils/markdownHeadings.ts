/**
 * 본문 마크다운의 헤딩 레벨을 h2부터 시작하도록 통째로 옮긴다.
 *
 * 게시물·프로젝트 본문은 대부분 `###`로 소제목을 쓴다. 페이지 제목이 h1이므로
 * 그대로 두면 h1 → h3로 레벨을 건너뛴다.
 *
 * 기준은 '가장 얕은 레벨'이 아니라 '첫 헤딩'이다. 최솟값을 기준으로 삼으면,
 * 제목을 한 번 더 적느라 `###`로 시작한 뒤 본문은 `##`로 쓴 글에서 이동량이
 * 0이 되어 첫 헤딩이 h3로 남는다(실제 프로젝트 1건). 첫 헤딩을 h2로 맞추고
 * 나머지는 같은 폭만큼 밀되, h2보다 얕아지지 않게 잡아 둔다.
 */
export function shiftMarkdownHeadings(markdown: string): string {
  if (!markdown) return markdown
  const first = markdown.match(/^(#{1,6})\s+/m)
  if (!first) return markdown
  const shift = 2 - first[1].length
  return markdown.replace(/^(#{1,6})(\s+)/gm, (_, hashes: string, space: string) => {
    const next = Math.min(6, Math.max(2, hashes.length + shift))
    return '#'.repeat(next) + space
  })
}
