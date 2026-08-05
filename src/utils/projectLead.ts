import type { Project } from '@/types'

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// ISO(YYYY-MM-DD)를 문자열 분해로 포맷 — new Date() 타임존 이슈 회피.
function formatDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return locale === 'en' ? `${EN_MONTHS[m - 1]} ${d}, ${y}` : `${y}년 ${m}월 ${d}일`
}

type LeadFields = Pick<
  Project,
  'title' | 'category' | 'eventDate' | 'venue' | 'cancelled' | 'hostedByGgac'
>

/**
 * 공연·행사 답변-우선 리드를 구조화 필드에서 자동 생성한다.
 * 수동 `lead`가 없을 때의 폴백 — 사실(제목·날짜·장소·주최·취소)은 필드에서만 취한다.
 * 조사 문제를 피하려 제목을 문장 끝 〈〉 안에 둔다.
 */
export function deriveProjectLead(
  project: LeadFields,
  locale = 'ko',
  opts: { isUpcoming?: boolean } = {}
): string {
  const isEn = locale === 'en'
  const { title, eventDate, cancelled, hostedByGgac } = project
  const venueName = project.venue?.name

  if (eventDate) {
    const date = formatDate(eventDate, locale)
    if (isEn) {
      const at = venueName ? ` at ${venueName}` : ''
      if (cancelled) {
        return `${title} was a concert planned for ${date}${at}, later cancelled.`
      }
      const by = hostedByGgac ? ' by Gyeonggi Art Collective' : ''
      const tense = opts.isUpcoming ? 'is a concert' : 'was a concert'
      return `${title} ${tense}${by} held${at} on ${date}.`
    }
    const at = venueName ? ` ${venueName}에서` : ''
    if (cancelled) {
      return `${date}${at} 열릴 예정이었으나 취소된 공연 〈${title}〉입니다.`
    }
    if (hostedByGgac) {
      const verb = opts.isUpcoming ? '여는' : '연'
      return `경기아트콜렉티브가 ${date}${at} ${verb} 공연 〈${title}〉입니다.`
    }
    const verb = opts.isUpcoming ? '열리는' : '열린'
    return `${date}${at} ${verb} 공연 〈${title}〉입니다.`
  }

  // 날짜 없는 행사/활동
  if (isEn) return `${title} is an event by Gyeonggi Art Collective.`
  return `경기아트콜렉티브의 ${project.category} 〈${title}〉입니다.`
}
