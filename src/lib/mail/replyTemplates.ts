/**
 * 답장 템플릿 규칙 — 화면과 라우트가 같이 쓴다. 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 */

export const TEMPLATE_NAME_MAX = 40
export const TEMPLATE_BODY_MAX = 5000
export const MAX_TEMPLATES = 50

/** 이름 — 앞뒤·연속 공백을 정리하고 1~40자. 아니면 null. */
export function normalizeTemplateName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  return name && name.length <= TEMPLATE_NAME_MAX ? name : null
}

/** 본문 — 줄바꿈은 지키고 앞뒤 빈 줄만 털어 1~5000자(CRLF는 LF로). 아니면 null. */
export function normalizeTemplateBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const body = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n|\n\s*$/g, '')
    .trimEnd()
  return body.trim() && body.length <= TEMPLATE_BODY_MAX ? body : null
}

/**
 * 템플릿을 쓰던 본문 끝에 덧붙인다 — 비어 있으면 템플릿만, 아니면 빈 줄 하나를 사이에 둔다. 쓰던 글을 지우지 않는다.
 */
export function appendTemplate(current: string, template: string): string {
  const base = current.replace(/\s+$/, '')
  return base ? `${base}\n\n${template}` : template
}
