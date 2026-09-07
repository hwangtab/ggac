/**
 * 어떤 주소로 온 메일을 저장할지 판정한다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test` 타입 스트리핑 제약.
 *
 * catch-all 을 쓰지 않는 이유: Resend Free 플랜은 일 100통·월 3,000통이고
 * **수신이 발신 쿼터를 함께 먹는다.** 도메인 전체를 받으면 스팸이 쿼터를 갉아
 * 회원가입 인증 메일과 비밀번호 재설정 메일이 같이 멈춘다.
 *
 * 주의: 이 판정은 **저장**을 막을 뿐 쿼터 소모를 막지 못한다. 메일은 이미
 * Resend 에 도착해 통수를 깎은 뒤다. 소모 감시는 웹훅 라우트의 임계치 경보가 한다.
 */

/** `표시 이름 <a@b.c>` 에서 주소만 뽑는다. 꺾쇠가 없으면 통째로 본다. */
function normalizeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/)
  return (match ? match[1] : value).trim().toLowerCase()
}

export function parseAllowedRecipients(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(entry => normalizeAddress(entry))
    .filter(entry => entry.length > 0)
}

export function isAllowedRecipient(candidates: string[], allowed: string[]): boolean {
  if (allowed.length === 0 || candidates.length === 0) return false
  const allowedSet = new Set(allowed.map(entry => normalizeAddress(entry)))
  return candidates.some(candidate => allowedSet.has(normalizeAddress(candidate)))
}
