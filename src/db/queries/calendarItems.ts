/**
 * 캘린더 항목 판정 — 순수 함수. `src/db/queries/calendar.ts`에서 분리했다.
 *
 * 이유: `calendar.ts`는 `../../lib/data.ts`(`getProjects`)를 값 import하는데,
 * 그 파일이 `next/cache`의 `cache()`를 쓴다. Next.js 런타임 밖(plain
 * `node --test`)에서는 `next/cache`가 해석되지 않아 `toCalendarItems`만 쓰는
 * 테스트도 모듈 로드 단계에서 죽는다. 판정 로직을 이 파일로 옮기면 테스트가
 * `next`를 건드리지 않고 순수 함수만 로드한다.
 *
 * 이 모듈은 **권한도 선호도 모른다.** 개인 필터(관심사)는 라우트가 건다.
 */
import { resolveBoardMeetingTime } from '../../constants/boardRoom.ts'
import type { MeetingRow } from './board.ts'
import type { GrantItem } from './grantDigests.ts'

export interface CalendarItem {
  /** `${kind}:${소스별 id}` — 렌더 키이자 중복 제거 키. */
  key: string
  kind: 'grant' | 'project' | 'board'
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM'. 이사회만 값이 있고 나머지는 null. */
  time: string | null
  title: string
  url: string | null
  /** grant만. 개인 필터에 쓴다. */
  genres?: string[]
  regions?: string[]
}

export interface CalendarRange {
  /** 'YYYY-MM-DD', 포함 */
  from: string
  /** 'YYYY-MM-DD', 포함 */
  to: string
}

export interface CalendarSources {
  grants: GrantItem[]
  meetings: MeetingRow[]
  /** `data/projects.json`의 항목 중 이 함수가 쓰는 필드만. */
  projects: { slug: string; title: string; eventDate?: string }[]
}

/** 'YYYY-MM-DD' 문자열 비교로 범위를 판정한다 — 사전순이 곧 시간순이다. */
function inRange(date: string, range: CalendarRange): boolean {
  return date >= range.from && date <= range.to
}

/**
 * 세 소스를 하나의 배열로 합친다. **순수 함수** — 네트워크·DB 접근이 없다.
 *
 * 빠지는 것:
 * - 관리자가 이번 회차에서 뺀 공고(`excluded: true`) — 발행 경로(`activeItems`)와 같은
 *   기준이다. 여기서 걸지 않으면 게시글·메일에서는 빠진 공고가 캘린더에만 남는다.
 * - 마감이 없는 상시 공고(`apply_end: null`) — 달력에 찍을 자리가 없다. 화면이 그리드
 *   아래 별도 목록으로 따로 보여준다.
 * - 날짜가 정해지지 않은 회의(`meeting_date: null`, 일정 투표 중) — 같은 이유.
 * - `eventDate`가 없는 프로젝트.
 */
export function toCalendarItems(sources: CalendarSources, range: CalendarRange): CalendarItem[] {
  const out: CalendarItem[] = []
  const seen = new Set<string>()

  const push = (item: CalendarItem) => {
    if (seen.has(item.key)) return
    seen.add(item.key)
    out.push(item)
  }

  for (const g of sources.grants) {
    if (g.excluded) continue
    if (!g.apply_end) continue
    if (!inRange(g.apply_end, range)) continue
    push({
      key: `grant:${g.key}`,
      kind: 'grant',
      date: g.apply_end,
      time: null,
      title: g.title,
      url: g.url,
      genres: g.genres,
      regions: g.regions,
    })
  }

  for (const p of sources.projects) {
    if (!p.eventDate) continue
    if (!inRange(p.eventDate, range)) continue
    push({
      key: `project:${p.slug}`,
      kind: 'project',
      date: p.eventDate,
      time: null,
      title: p.title,
      url: `/projects/${p.slug}`,
    })
  }

  for (const m of sources.meetings) {
    if (!m.meeting_date) continue
    if (!inRange(m.meeting_date, range)) continue
    // 제목·날짜·시간만 담는다. 출석·정족수·일정투표는 canAccessBoardRoom(이사·감사·관리자)
    // 경계 안이고, 캘린더는 승인·활성 조합원 전체가 본다.
    push({
      key: `board:${m.id}`,
      kind: 'board',
      date: m.meeting_date,
      time: resolveBoardMeetingTime(m.meeting_time),
      title: m.title,
      url: `/board-room/meetings/${m.id}`,
    })
  }

  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1))
}

/**
 * 마감이 없는 상시 공고. **달력에 찍을 자리가 없어** `toCalendarItems`가 버리는 것들이라,
 * 화면이 그리드 아래 목록으로 따로 보여준다. 여기서 빠뜨리면 상시 공고는 조합원이 볼 곳이
 * 게시글뿐이 된다.
 *
 * `excluded` 항목은 여기서도 뺀다 — `toCalendarItems`와 같은 기준.
 *
 * `date`는 빈 문자열이다 — `CalendarItem` 형태를 그대로 쓰되 날짜가 없음을 나타낸다.
 */
export function toOngoingGrants(grants: GrantItem[]): CalendarItem[] {
  const out: CalendarItem[] = []
  const seen = new Set<string>()
  for (const g of grants) {
    if (g.excluded) continue
    if (g.apply_end) continue
    const key = `grant:${g.key}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      kind: 'grant',
      date: '',
      time: null,
      title: g.title,
      url: g.url,
      genres: g.genres,
      regions: g.regions,
    })
  }
  return out
}
