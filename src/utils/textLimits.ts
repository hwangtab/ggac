/**
 * 자유 입력 칸의 **서버 쪽** 길이 상한.
 *
 * 화면의 `maxLength`는 예의일 뿐이다 — 라우트는 화면을 거치지 않은 요청도 받는다.
 * 상한이 없는 칸은 한 번의 POST로 수십 MB를 넣을 수 있고, 그것이 DB 행·목록
 * 응답·알림 본문을 타고 그대로 퍼진다.
 *
 * 값은 이미 이 저장소에 있던 상한과 맞춘다:
 * - 제목 200자 — `validatePostTitle`(`@/utils/validation.ts`)·알림 제목과 같다.
 * - 댓글 5,000자 — 알림 본문(1,000자)보다 넉넉하고 본문(50,000자)보다 좁다.
 * - 이메일 254자 — `validateEmail`과 같다(RFC 5321의 주소 상한).
 */
export const TEXT_LIMITS = {
  POST_TITLE: 200,
  POST_CONTENT: 50_000,
  COMMENT_CONTENT: 5_000,
  BOOKER_NAME: 100,
  BOOKER_PHONE: 20,
  BOOKER_EMAIL: 254,
} as const

/**
 * 한글 받침 유무로 주격 조사를 고른다. '제목이'·'연락처가'처럼 붙는다.
 * 한글이 아닌 글자로 끝나면(영문·숫자) '이'를 쓴다 — 안내문 주체가 한글
 * 명사인 자리에서만 쓰는 함수다.
 */
function subjectParticle(label: string): string {
  const last = label.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 === 0 ? '가' : '이'
  }
  return '이'
}

/**
 * 상한을 넘으면 한글 안내문을, 넘지 않으면 `null`을 돌려준다.
 *
 * 길이는 자바스크립트 문자열 길이(UTF-16 단위)로 센다 — 상한이 넉넉하므로
 * 이모지가 두 칸을 먹는 것이 문제가 되는 자리가 없다.
 */
export function textLengthError(value: unknown, max: number, label: string): string | null {
  if (typeof value !== 'string') return null
  if (value.length <= max) return null
  return `${label}${subjectParticle(label)} 너무 깁니다. 최대 ${max.toLocaleString('ko-KR')}자까지 입력할 수 있습니다.`
}
