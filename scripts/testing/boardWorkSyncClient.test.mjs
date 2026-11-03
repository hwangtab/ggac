import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 채팅 화면 이식(1b)의 순수 규칙 — 폴링 주기·새 글 판정·활동 순서(src/work/lib/sync/poll.ts)와
 * 원본 경로 ↔ /board-room 경로 변환(src/work/lib/nav/paths.ts). 계약: docs/board-work/02-sync.md §5, 설계 §2-1·§6-3.
 */
const { nextPollDelay, messageOp, channelsWithNewActivity, POLL_FOCUSED_MS, POLL_IDLE_MS } =
  await import('../../src/work/lib/sync/poll.ts')
const { toWorkHref, fromWorkPathname, localeOfPathname } = await import(
  '../../src/work/lib/nav/paths.ts'
)

test('폴링 주기: 채널을 보면 3초, 아니면 10초, 실패하면 3→6→12→30초', () => {
  assert.equal(nextPollDelay({ focused: true, failures: 0 }), 3000)
  assert.equal(nextPollDelay({ focused: false, failures: 0 }), 10000)
  assert.equal(POLL_FOCUSED_MS, 3000)
  assert.equal(POLL_IDLE_MS, 10000)
  // 실패 백오프는 화면과 무관하다(배지만 보는 화면도 실패하면 3초부터)
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map(failures => nextPollDelay({ focused: false, failures })),
    [3000, 6000, 12000, 30000, 30000, 30000]
  )
})

test('새 글 판정: 지난 응답 뒤에 만들어졌고 고친 적 없으면 INSERT', () => {
  const since = Date.parse('2026-11-02T00:00:10Z')
  const row = (created, extra = {}) => ({
    created_at: created,
    edited_at: null,
    deleted_at: null,
    ...extra,
  })
  assert.equal(messageOp(row('2026-11-02T00:00:11Z'), since), 'INSERT')
  // 지난 응답 전에 있던 글이 다시 왔다 = 반응·답글 수·고정 등 변경
  assert.equal(messageOp(row('2026-11-02T00:00:09Z'), since), 'UPDATE')
  assert.equal(messageOp(row('2026-11-02T00:00:11Z', { edited_at: 'x' }), since), 'UPDATE')
  assert.equal(messageOp(row('2026-11-02T00:00:11Z', { deleted_at: 'x' }), since), 'UPDATE')
  assert.equal(messageOp(row('2026-11-02T00:00:01Z'), null), 'INSERT')
})

test('활동 순서: 안 읽은 수가 늘어난 채널만 올린다(첫 스냅샷은 비교하지 않는다)', () => {
  const snap = channels => ({ channels, mentionCount: 0, activityCount: 0 })
  const a = snap({ c1: { unread: 1, mentions: 0 }, c2: { unread: 0, mentions: 0 } })
  const b = snap({
    c1: { unread: 1, mentions: 0 },
    c2: { unread: 2, mentions: 0 },
    c3: { unread: 1, mentions: 0 },
  })
  assert.deepEqual(channelsWithNewActivity(null, a), [])
  assert.deepEqual(channelsWithNewActivity(a, b).sort(), ['c2', 'c3'])
  // 읽어서 줄어든 것은 올리지 않는다
  assert.deepEqual(channelsWithNewActivity(b, a), [])
})

test('나가는 주소: 원본 업무툴 경로는 /board-room 아래로, 나머지는 그대로', () => {
  assert.equal(toWorkHref('/c/general'), '/board-room/c/general')
  assert.equal(toWorkHref('/dm/abc?thread=x#msg-1'), '/board-room/dm/abc?thread=x#msg-1')
  assert.equal(toWorkHref('/chat?new=1'), '/board-room/chat?new=1')
  assert.equal(toWorkHref('/inbox/mentions'), '/board-room/inbox/mentions')
  assert.equal(toWorkHref('/settings/notifications'), '/board-room/settings/notifications')
  assert.equal(toWorkHref('/c'), '/board-room/c')
  // 원본 홈(/)은 업무툴 첫 화면 — ggac /board-room(이사회실 대시보드)과 겹치지 않게
  assert.equal(toWorkHref('/'), '/board-room/chat')
  // 이미 고친 주소(1a channelHref·messageLink)는 다시 붙이지 않는다
  assert.equal(toWorkHref('/board-room/c/general'), '/board-room/c/general')
  // 업무툴이 아닌 곳·외부·API는 건드리지 않는다
  assert.equal(toWorkHref('/board-room'), '/board-room')
  assert.equal(toWorkHref('/login'), '/login')
  assert.equal(toWorkHref('/api/board-room/work/sync'), '/api/board-room/work/sync')
  assert.equal(toWorkHref('https://example.com/c/x'), 'https://example.com/c/x')
  assert.equal(toWorkHref('//evil.example/c'), '//evil.example/c')
  assert.equal(toWorkHref('#msg-1'), '#msg-1')
  // 섹션 이름이 앞부분만 같은 경로는 업무툴이 아니다
  assert.equal(toWorkHref('/calendar'), '/calendar')
  assert.equal(toWorkHref('/charter'), '/charter')
})

test('나가는 주소: 영어 화면이면 /en을 이어 붙인다(업무툴·이사회실만)', () => {
  assert.equal(toWorkHref('/c/general', 'en'), '/en/board-room/c/general')
  assert.equal(toWorkHref('/board-room', 'en'), '/en/board-room')
  assert.equal(toWorkHref('/board-room/dm/x', 'en'), '/en/board-room/dm/x')
  assert.equal(toWorkHref('/login', 'en'), '/login')
  assert.equal(toWorkHref('/en/board-room/c/x', 'en'), '/en/board-room/c/x')
})

test('들어오는 경로: /board-room·로케일을 떼어 원본 모양으로', () => {
  assert.equal(fromWorkPathname('/board-room/c/general'), '/c/general')
  assert.equal(fromWorkPathname('/en/board-room/inbox/mentions'), '/inbox/mentions')
  assert.equal(fromWorkPathname('/ko/board-room/dm/x'), '/dm/x')
  assert.equal(fromWorkPathname('/board-room/chat'), '/chat')
  assert.equal(fromWorkPathname('/board-room'), '/board-room')
  assert.equal(fromWorkPathname('/board-room/meetings'), '/board-room/meetings')
  assert.equal(fromWorkPathname(null), null)
  assert.equal(localeOfPathname('/en/board-room/c/x'), 'en')
  assert.equal(localeOfPathname('/ko/board-room/c/x'), null)
  assert.equal(localeOfPathname('/board-room/c/x'), null)
  assert.equal(localeOfPathname('/entry'), null)
})
