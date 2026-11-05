/**
 * 발신자 규칙의 순수한 규칙 — 조건 정규화, 공용 메일 도메인 판정, 맞은 규칙들을 하나의 결과로 합치기.
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약. 화면과 라우트가 같이 쓴다.
 */

export type RuleMatchType = 'address' | 'domain'
export type RuleAction = 'spam' | 'archive' | 'label'

export const RULE_MATCH_TYPES: readonly RuleMatchType[] = ['address', 'domain']
export const RULE_ACTIONS: readonly RuleAction[] = ['spam', 'archive', 'label']
/** 규칙 개수 상한 — 수신마다 규칙을 훑으므로 끝없이 늘지 않게. */
export const MAX_RULES = 200

/**
 * 도메인 전체에 걸면 조합원·협력처 메일까지 휩쓸리는 공용 메일 서비스. 이 도메인의 규칙은 라우트가 한 번 더 확인을
 * 받는다(`confirm_public_domain`). 목록은 완전하지 않다 — 흔한 것만 막는 안전장치다.
 */
export const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'kakao.com',
  'nate.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
])

export function isPublicMailDomain(domain: string): boolean {
  return PUBLIC_MAIL_DOMAINS.has(domain.trim().toLowerCase())
}

/**
 * 조건 값 정규화. 주소는 `이름 <a@b>`를 붙여 넣어도 주소만, 도메인은 앞의 `@`를 떼고. 소문자. 형식이 아니면 null.
 * 주소는 `from_email`과, 도메인은 `from_email`의 `@` 뒤와 **완전 일치**로 맞춘다.
 */
export function normalizeRuleValue(type: RuleMatchType, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (type === 'address') {
    const angle = text.match(/<([^<>\s]+)>/)
    const address = (angle ? angle[1] : text).trim().toLowerCase()
    return /^[^\s@<>"]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(address) &&
      address.length <= 254
      ? address
      : null
  }
  const domain = text.replace(/^@/, '').toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))+$/.test(domain) &&
    domain.length <= 253
    ? domain
    : null
}

export type MatchedRule = { action: RuleAction; label_id: string | null }

/**
 * 맞은 규칙들을 하나로 합친다. 상태는 **스팸이 보관보다 앞선다**(둘 다 맞으면 스팸). 라벨은 모두 붙인다(중복 제거).
 * 맞은 규칙이 없으면 상태 null·라벨 없음.
 */
export function combineRules(rules: readonly MatchedRule[]): {
  status: 'spam' | 'archived' | null
  labelIds: string[]
} {
  const status = rules.some(r => r.action === 'spam')
    ? 'spam'
    : rules.some(r => r.action === 'archive')
      ? 'archived'
      : null
  const labelIds = [
    ...new Set(
      rules.filter(r => r.action === 'label' && r.label_id).map(r => r.label_id as string)
    ),
  ]
  return { status, labelIds }
}

export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
  spam: '스팸으로',
  archive: '보관함으로',
  label: '라벨 붙이기',
}
