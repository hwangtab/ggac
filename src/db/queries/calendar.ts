/**
 * 캘린더에 찍을 항목을 세 소스에서 모은다 — 지원사업 마감·조합 행사·이사회 회의.
 *
 * 이 모듈은 **권한도 선호도 모른다.** 개인 필터(관심사)는 라우트가 건다.
 *
 * 소스가 셋이고 저장 위치가 제각각이다: 지원사업은 `grant_digests.items` JSON 안,
 * 행사는 `data/projects.json` 정적 파일, 회의는 `board_meetings` 표. 그래서 조회
 * 배선(`listCalendarItems`, 이 파일)과 판정(`toCalendarItems`, `calendarItems.ts`)을
 * 파일로도 나눴다 — `getProjects`(`../../lib/data.ts`)가 `next/cache`의 `cache()`를
 * 값 import해서, 판정 로직이 이 파일에 같이 있으면 plain `node --test`가 `next/cache`
 * 해석에 걸려 순수 함수 테스트까지 죽는다. 판정만 테스트한다.
 */
import { getProjects } from '../../lib/data.ts'
import { listMeetings } from './board.ts'
import { listRecentDigestItems } from './grantDigests.ts'
import {
  toCalendarItems,
  toOngoingGrants,
  type CalendarItem,
  type CalendarRange,
} from './calendarItems.ts'

export { toCalendarItems, toOngoingGrants, type CalendarItem, type CalendarRange }

/** 최근 회차에서 공고를 모을 범위. 마감이 최대 90일 뒤이므로 넉넉히 잡는다. */
const DIGEST_LOOKBACK_WEEKS = 26

/**
 * 세 소스를 조회해 `toCalendarItems`·`toOngoingGrants`에 넘긴다. 개인 필터는 걸지 않는다 —
 * 라우트의 몫이다.
 * @throws 조회가 실패하면 그대로 던진다.
 */
export async function listCalendarItems(
  range: CalendarRange
): Promise<{ items: CalendarItem[]; ongoing: CalendarItem[] }> {
  const [grants, meetings, projects] = await Promise.all([
    listRecentDigestItems(DIGEST_LOOKBACK_WEEKS),
    listMeetings(),
    getProjects('ko'),
  ])
  return {
    items: toCalendarItems({ grants, meetings, projects }, range),
    ongoing: toOngoingGrants(grants),
  }
}
