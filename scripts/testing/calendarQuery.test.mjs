import { test } from 'node:test'
import assert from 'node:assert/strict'

// 순수 함수는 calendarItems.ts에 있다 — calendar.ts를 import하면 getProjects가
// next/cache의 cache()를 끌고 들어와 plain `node --test`에서 모듈 로드가 죽는다.
const { toCalendarItems, toOngoingGrants } = await import('../../src/db/queries/calendarItems.ts')

const RANGE = { from: '2026-09-01', to: '2026-09-30' }

function grant(over = {}) {
  return {
    key: 'ncas:1',
    source: 'ncas',
    source_id: '1',
    title: '음악 창작지원',
    genres: ['음악'],
    regions: ['경기'],
    category: 'grant',
    apply_start: null,
    apply_end: '2026-09-15',
    url: 'https://example.test/1',
    summary: null,
    biz_type: null,
    target: null,
    ...over,
  }
}
function meeting(over = {}) {
  return {
    id: 'm1',
    title: '2026년 제7차 이사회',
    meeting_date: '2026-09-10',
    meeting_time: '15:00',
    location: null,
    status: 'scheduled',
    vote_deadline: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}
function project(over = {}) {
  return { slug: 'concert-1', title: '가을 공연', eventDate: '2026-09-20', ...over }
}

// ---------------------------------------------------------------- 세 소스가 합쳐진다

test('세 소스가 하나의 배열로 합쳐진다', () => {
  const out = toCalendarItems(
    { grants: [grant()], meetings: [meeting()], projects: [project()] },
    RANGE
  )
  assert.deepEqual(out.map(i => i.kind).sort(), ['board', 'grant', 'project'])
})

test('날짜순으로 정렬된다', () => {
  const out = toCalendarItems(
    {
      grants: [grant({ apply_end: '2026-09-15' })],
      meetings: [meeting({ meeting_date: '2026-09-10' })],
      projects: [project({ eventDate: '2026-09-20' })],
    },
    RANGE
  )
  assert.deepEqual(
    out.map(i => i.date),
    ['2026-09-10', '2026-09-15', '2026-09-20']
  )
})

test('각 항목에 안정 키가 붙는다', () => {
  const out = toCalendarItems(
    { grants: [grant()], meetings: [meeting()], projects: [project()] },
    RANGE
  )
  const keys = out.map(i => i.key)
  assert.ok(keys.includes('grant:ncas:1'))
  assert.ok(keys.includes('board:m1'))
  assert.ok(keys.includes('project:concert-1'))
  assert.equal(new Set(keys).size, keys.length)
})

// ---------------------------------------------------------------- 범위

test('범위 밖 항목은 빠진다', () => {
  const out = toCalendarItems(
    { grants: [grant({ apply_end: '2026-10-05' })], meetings: [], projects: [] },
    RANGE
  )
  assert.equal(out.length, 0)
})

test('범위 경계는 포함한다', () => {
  const out = toCalendarItems(
    {
      grants: [
        grant({ key: 'a', apply_end: '2026-09-01' }),
        grant({ key: 'b', apply_end: '2026-09-30' }),
      ],
      meetings: [],
      projects: [],
    },
    RANGE
  )
  assert.equal(out.length, 2)
})

// ---------------------------------------------------------------- 상시 공고

test('마감 없는 상시 공고는 캘린더 항목이 아니다', () => {
  const out = toCalendarItems(
    { grants: [grant({ apply_end: null })], meetings: [], projects: [] },
    RANGE
  )
  assert.equal(out.length, 0)
})

// ---------------------------------------------------------------- 이사회

test('날짜가 없는 회의(일정 투표 중)는 빠진다', () => {
  const out = toCalendarItems(
    { grants: [], meetings: [meeting({ meeting_date: null, status: 'polling' })], projects: [] },
    RANGE
  )
  assert.equal(out.length, 0)
})

test('회의 시간이 없으면 기본 시간을 쓴다', () => {
  const out = toCalendarItems(
    { grants: [], meetings: [meeting({ meeting_time: null })], projects: [] },
    RANGE
  )
  assert.equal(out[0].time, '21:00')
})

test('회의 항목에 출석·정족수·투표 정보가 담기지 않는다', () => {
  const out = toCalendarItems({ grants: [], meetings: [meeting()], projects: [] }, RANGE)
  const item = out[0]
  assert.deepEqual(Object.keys(item).sort(), ['date', 'key', 'kind', 'time', 'title', 'url'].sort())
})

// ---------------------------------------------------------------- 지원사업 항목

test('지원사업 항목에는 장르·지역이 실린다 (개인 필터용)', () => {
  const out = toCalendarItems({ grants: [grant()], meetings: [], projects: [] }, RANGE)
  assert.deepEqual(out[0].genres, ['음악'])
  assert.deepEqual(out[0].regions, ['경기'])
  assert.equal(out[0].time, null)
})

test('같은 공고가 여러 회차에 있어도 하나만 남는다', () => {
  const out = toCalendarItems(
    { grants: [grant({ key: 'ncas:1' }), grant({ key: 'ncas:1' })], meetings: [], projects: [] },
    RANGE
  )
  assert.equal(out.length, 1)
})

// ---------------------------------------------------------------- 행사

test('eventDate 없는 프로젝트는 빠진다', () => {
  const out = toCalendarItems(
    { grants: [], meetings: [], projects: [project({ eventDate: undefined })] },
    RANGE
  )
  assert.equal(out.length, 0)
})

test('빈 입력은 빈 배열이다', () => {
  assert.deepEqual(toCalendarItems({ grants: [], meetings: [], projects: [] }, RANGE), [])
})

// ---------------------------------------------------------------- 상시 공고 목록 (toOngoingGrants)

test('toOngoingGrants는 마감 없는 공고만 돌려준다', () => {
  const out = toOngoingGrants([
    grant({ key: 'a', apply_end: '2026-09-15' }),
    grant({ key: 'b', apply_end: null, title: '상시 공고' }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].title, '상시 공고')
  assert.equal(out[0].kind, 'grant')
  assert.equal(out[0].date, '')
})

test('toOngoingGrants도 중복을 제거한다', () => {
  const out = toOngoingGrants([
    grant({ key: 'x', apply_end: null }),
    grant({ key: 'x', apply_end: null }),
  ])
  assert.equal(out.length, 1)
})

test('toOngoingGrants는 장르·지역을 실어 준다 (개인 필터용)', () => {
  const out = toOngoingGrants([grant({ apply_end: null, genres: ['음악'], regions: ['서울'] })])
  assert.deepEqual(out[0].genres, ['음악'])
  assert.deepEqual(out[0].regions, ['서울'])
})

// ---------------------------------------------------------------- excluded 항목 (F2)

test('toCalendarItems는 excluded 항목을 캘린더에 담지 않는다', () => {
  const out = toCalendarItems(
    {
      grants: [
        grant({ key: 'kept', apply_end: '2026-09-15' }),
        grant({ key: 'dropped', apply_end: '2026-09-20', excluded: true }),
      ],
      meetings: [],
      projects: [],
    },
    RANGE
  )
  assert.deepEqual(
    out.map(i => i.key),
    ['grant:kept']
  )
})

test('toOngoingGrants는 excluded 항목을 상시 목록에 담지 않는다', () => {
  const out = toOngoingGrants([
    grant({ key: 'kept', apply_end: null }),
    grant({ key: 'dropped', apply_end: null, excluded: true }),
  ])
  assert.deepEqual(
    out.map(i => i.key),
    ['grant:kept']
  )
})
