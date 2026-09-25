/**
 * 크레딧(부클릿·웹사이트)에 실을 이름 규칙. 네트워크·DB를 모른다.
 *
 * 한 후원에 이름 하나가 기본이고, 수량을 여럿 고르면 그만큼 쉼표로 나눠 적을
 * 수 있다. 수량보다 많은 이름은 받지 않는다 — 이름 하나가 곧 리워드 하나다.
 */

export const CREDIT_NAME_MAX_LENGTH = 100

export function normalizeCreditName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CREDIT_NAME_MAX_LENGTH)
}

export function splitCreditNames(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map(n => n.trim())
    .filter(n => n !== '')
}

export type CreditNameVerdict =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'required' | 'too_many' }

/** 이름 기재 리워드가 아니면 입력이 있어도 버린다(null). */
export function evaluateCreditName(input: {
  requiresCreditName: boolean
  raw: unknown
  quantity: number
}): CreditNameVerdict {
  if (!input.requiresCreditName) return { ok: true, value: null }
  const value = normalizeCreditName(input.raw)
  const names = splitCreditNames(value)
  if (names.length === 0) return { ok: false, reason: 'required' }
  if (names.length > input.quantity) return { ok: false, reason: 'too_many' }
  return { ok: true, value: names.join(', ') }
}
