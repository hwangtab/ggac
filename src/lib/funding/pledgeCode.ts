import { randomInt } from 'node:crypto'

/** 헷갈리는 글자(0/O, 1/I)를 뺀다 — 전화로 불러 대조할 때 잘못 듣는다. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function kstDateStamp(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10).replace(/-/g, '')
}

/** `FND-YYYYMMDD-XXXXXXXX`. 날짜는 KST. */
export function generatePledgeCode(now: Date = new Date()): string {
  let suffix = ''
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)]
  return `FND-${kstDateStamp(now)}-${suffix}`
}

export function isPledgeCode(value: unknown): value is string {
  return typeof value === 'string' && /^FND-\d{8}-[A-HJ-NP-Z2-9]{8}$/.test(value)
}
