/**
 * 한국어 조사 고르기(받침 유무).
 * - 으로/로: 받침이 없거나 ㄹ 받침이면 '로', 그 외 받침은 '으로'
 * 한글이 아니면 숫자 읽기·영문 끝소리를 대략 따른다.
 */

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
/** 숫자 읽기의 끝소리(0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 — 1·7·8 은 ㄹ 받침) */
const DIGIT_FINAL: Record<string, 'none' | 'rieul' | 'other'> = {
  '0': 'other',
  '1': 'rieul',
  '2': 'none',
  '3': 'other',
  '4': 'none',
  '5': 'none',
  '6': 'other',
  '7': 'rieul',
  '8': 'rieul',
  '9': 'none',
}

function finalSound(word: string): 'none' | 'rieul' | 'other' {
  const trimmed = word.replace(/[\s)\]"'.]+$/u, '')
  const last = trimmed.at(-1)
  if (!last) return 'none'
  const code = last.charCodeAt(0)
  if (code >= HANGUL_START && code <= HANGUL_END) {
    const jong = (code - HANGUL_START) % 28
    if (jong === 0) return 'none'
    return jong === 8 ? 'rieul' : 'other'
  }
  if (last in DIGIT_FINAL) return DIGIT_FINAL[last]
  const lower = last.toLowerCase()
  if (lower === 'l') return 'rieul'
  // 영문 끝 m·n 만 받침으로 친다(guest → 게스트로처럼 파열음 끝은 모음으로 읽힌다).
  if (lower === 'm' || lower === 'n') return 'other'
  return 'none'
}

/** `시스템 설정` → `시스템 설정으로`, `다크` → `다크로`, `게스트` → `게스트로`, `서울` → `서울로` */
export function withEuro(word: string): string {
  return `${word}${finalSound(word) === 'other' ? '으로' : '로'}`
}
