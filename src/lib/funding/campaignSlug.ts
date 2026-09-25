/**
 * 승인할 때 붙일 공개 주소(slug)를 제안한다. 아무것도 import 하지 않는다 —
 * 관리자 화면(클라이언트)과 승인 라우트가 같은 규칙을 쓴다.
 *
 * 개설자 이름과 제목에서 영문·숫자 낱말만 골라 이어 붙인다("Sabbaha" +
 * "사바하 정규 2집 《SLUNG》…" → `sabbaha-slung`). 글자가 없는 숫자 낱말("2")은
 * 뜻이 없어 뺀다. 영문 낱말이 하나도 없으면 캠페인 번호로 떨어진다.
 */

export const CAMPAIGN_SLUG_MAX_LENGTH = 60

export function slugWords(text: string | null | undefined): string[] {
  return (
    String(text ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).filter(word => /[a-z]/.test(word))
}

function shortId(id: string): string {
  return id
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 8)
}

export function suggestCampaignSlug(input: {
  ownerName?: string | null
  title?: string | null
  id: string
}): string {
  const words = [...new Set([...slugWords(input.ownerName), ...slugWords(input.title)])]
  let slug = ''
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word
    if (next.length > CAMPAIGN_SLUG_MAX_LENGTH) break
    slug = next
  }
  return slug.length >= 3 ? slug : `campaign-${shortId(input.id)}`
}

/** 제안 주소가 이미 쓰이면 차례로 시도할 후보. 마지막은 캠페인 번호라 겹치지 않는다. */
export function campaignSlugCandidates(base: string, id: string): string[] {
  const withSuffix = (suffix: string) =>
    `${base.slice(0, CAMPAIGN_SLUG_MAX_LENGTH - suffix.length - 1)}-${suffix}`
  return [base, ...[2, 3, 4, 5].map(n => withSuffix(String(n))), withSuffix(shortId(id))]
}
