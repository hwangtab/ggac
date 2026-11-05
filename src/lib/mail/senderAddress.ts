/**
 * 받은 메일의 발신자(`From`) 문자열을 주소와 표시 이름으로 나눈다.
 *
 * Resend 웹훅의 `from`은 `홍길동 <hong@a.org>`처럼 표시 이름이 붙어 올 수 있어, 원문(`from_address`)으로
 * "이 사람이 보낸 메일"을 찾으면 `LIKE`가 `akim@a.org`까지 `kim@a.org`로 잡는다. 정규화한 주소
 * (`from_email`)를 따로 두고 완전 일치로 거른다.
 *
 * **0037 마이그레이션의 백필 SQL과 같은 규칙이어야 한다** — 기존 행은 SQL이, 새 행은 이 함수가 채운다.
 * 규칙: 첫 `<` 뒤에 첫 `>`가 있으면 그 사이가 주소, `<` 앞이 이름(앞뒤 공백·큰따옴표 제거, 비면 null).
 * 없으면 통째로 주소이고 이름은 null. 주소는 앞뒤 공백을 털고 소문자로 만든다.
 * 대조는 `scripts/testing/mailboxSender.test.mjs`가 한다.
 *
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 */

export type ParsedMailbox = { email: string; name: string | null }

export function parseMailbox(value: unknown): ParsedMailbox {
  if (typeof value !== 'string') return { email: '', name: null }
  const lt = value.indexOf('<')
  const gt = value.indexOf('>')
  if (lt >= 0 && gt > lt) {
    const name = value
      .slice(0, lt)
      .trim()
      .replace(/^"+|"+$/g, '')
      .trim()
    return {
      email: value
        .slice(lt + 1, gt)
        .trim()
        .toLowerCase(),
      name: name || null,
    }
  }
  return { email: value.trim().toLowerCase(), name: null }
}

/** 도메인 필터 입력을 정규화한다. 앞의 `@`는 떼고 소문자로. 도메인 글자가 아니면 null. */
export function normalizeSenderDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const domain = value.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain) ? domain : null
}

/** 주소에서 도메인(`@` 뒤)을 뽑는다. 없으면 null. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@')
  return at >= 0 && at < email.length - 1 ? email.slice(at + 1) : null
}
