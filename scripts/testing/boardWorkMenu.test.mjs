import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 이사회실 메뉴 '업무' 묶음 배지 규칙과 업무 화면 셸 배치 규칙 — docs/board-work/03-통합-재설계.md §2·§3·§8.
 * 둘 다 순수 함수라 파일을 직접 읽는다.
 */
const { boardWorkMenuBadges, conversationsFromSnapshot, formatMenuBadgeCount } = await import(
  '../../src/lib/boardWork/menuBadges.ts'
)
const { workSection, hasWorkListPane, mobileShowsList, mobileBackLink } = await import(
  '../../src/work/components/layout/work-layout.ts'
)

const NONE = { mentionCount: 0, activityCount: 0, openTaskCount: 0 }

test('대화 배지: 나를 부른 것(채널 멘션 + DM 안 읽음)은 앰버 숫자, 채널 안 읽음만 있으면 점', () => {
  // 아무것도 없으면 배지가 없다
  assert.deepEqual(boardWorkMenuBadges({ conversations: [], ...NONE }), {})

  // 채널 안 읽음만 → 점
  const dot = boardWorkMenuBadges({ conversations: [{ unread: 4, mentions: 0 }], ...NONE })
  assert.equal(dot.chat?.kind, 'dot')

  // 채널 멘션 2 + DM 안 읽음 3 → 숫자 5
  const mention = boardWorkMenuBadges({
    conversations: [
      { unread: 7, mentions: 2 },
      { unread: 3, mentions: 0, dm: true },
    ],
    ...NONE,
  })
  assert.equal(mention.chat?.kind, 'mention')
  assert.equal(mention.chat?.count, 5)

  // DM 안의 멘션은 안 읽음과 겹치므로 두 번 세지 않는다
  const dmMention = boardWorkMenuBadges({
    conversations: [{ unread: 2, mentions: 1, dm: true }],
    ...NONE,
  })
  assert.equal(dmMention.chat?.count, 2)
})

test('뮤트: 뮤트 채널의 안 읽음은 점을 세우지 않고, 뮤트 DM은 멘션만 센다', () => {
  assert.deepEqual(
    boardWorkMenuBadges({ conversations: [{ unread: 9, mentions: 0, muted: true }], ...NONE }),
    {}
  )
  assert.deepEqual(
    boardWorkMenuBadges({
      conversations: [{ unread: 9, mentions: 0, muted: true, dm: true }],
      ...NONE,
    }),
    {}
  )
  const mutedMention = boardWorkMenuBadges({
    conversations: [{ unread: 9, mentions: 1, muted: true }],
    ...NONE,
  })
  assert.equal(mutedMention.chat?.kind, 'mention')
  assert.equal(mutedMention.chat?.count, 1)
})

test('활동 = 멘션 + 새 답글·반응(앰버 숫자), 할 일 = 열린 수(강조 없는 숫자)', () => {
  const b = boardWorkMenuBadges({
    conversations: [],
    mentionCount: 2,
    activityCount: 3,
    openTaskCount: 5,
  })
  assert.deepEqual({ kind: b.inbox?.kind, count: b.inbox?.count }, { kind: 'mention', count: 5 })
  assert.match(b.inbox?.srText ?? '', /새 활동 5건/)
  assert.deepEqual({ kind: b.tasks?.kind, count: b.tasks?.count }, { kind: 'count', count: 5 })

  const onlyMentions = boardWorkMenuBadges({ conversations: [], ...NONE, mentionCount: 1 })
  assert.match(onlyMentions.inbox?.srText ?? '', /읽지 않은 멘션 1건/)

  // 음수·NaN 같은 이상한 값은 0으로 본다
  assert.deepEqual(
    boardWorkMenuBadges({
      conversations: [{ unread: -1, mentions: Number.NaN }],
      mentionCount: -3,
      activityCount: Number.NaN,
      openTaskCount: -1,
    }),
    {}
  )
  assert.equal(formatMenuBadgeCount(7), '7')
  assert.equal(formatMenuBadgeCount(100), '99+')
})

test('스냅숏 → 대화 재료: 목록에 없는 대화(새 DM·초대)는 뮤트 아닌 채널로 본다', () => {
  const list = conversationsFromSnapshot(
    {
      a: { unread: 1, mentions: 0 },
      b: { unread: 2, mentions: 0 },
      c: { unread: 3, mentions: 1 },
    },
    { a: { dm: true, muted: false }, b: { dm: false, muted: true } }
  )
  assert.deepEqual(list, [
    { unread: 1, mentions: 0, dm: true, muted: false },
    { unread: 2, mentions: 0, dm: false, muted: true },
    { unread: 3, mentions: 1, dm: false, muted: false },
  ])
  // 메타가 아직 없어도(요약 조회 전) 멘션은 숫자로 보인다
  const b = boardWorkMenuBadges({
    conversations: conversationsFromSnapshot({ x: { unread: 1, mentions: 1 } }, null),
    ...NONE,
  })
  assert.equal(b.chat?.count, 1)
})

test('셸 갈래: 채널·DM·채널 찾아보기는 대화, 업무 설정만 목록 칸이 없다', () => {
  for (const p of ['/chat', '/c', '/c/general', '/dm/x', '/dm/x/t/1']) {
    assert.equal(workSection(p), 'chat', p)
  }
  assert.equal(workSection('/inbox/mentions'), 'activity')
  assert.equal(workSection('/tasks'), 'tasks')
  assert.equal(workSection('/files/abc'), 'files')
  assert.equal(workSection('/search'), 'search')
  assert.equal(workSection('/settings/notifications'), 'settings')
  assert.equal(workSection('/chatter'), null)
  assert.equal(workSection('/'), null)
  assert.equal(hasWorkListPane('settings'), false)
  assert.equal(hasWorkListPane(null), false)
  for (const s of ['chat', 'activity', 'tasks', 'files', 'search']) {
    assert.equal(hasWorkListPane(s), true, s)
  }
})

test('좁은 화면: 대화 첫 화면은 목록, 대화는 ← 목록, 하위 화면은 ← 대화', () => {
  assert.equal(mobileShowsList('/chat'), true)
  assert.equal(mobileShowsList('/chat', { newChat: true }), false)
  assert.equal(mobileShowsList('/c/general'), false)
  assert.equal(mobileShowsList('/inbox'), false)

  assert.deepEqual(mobileBackLink('/c/general'), { href: '/chat', label: '목록' })
  assert.deepEqual(mobileBackLink('/dm/abc'), { href: '/chat', label: '목록' })
  assert.deepEqual(mobileBackLink('/c'), { href: '/chat', label: '목록' })
  assert.deepEqual(mobileBackLink('/chat', { newChat: true }), { href: '/chat', label: '목록' })
  assert.deepEqual(mobileBackLink('/c/general/t/1'), { href: '/c/general', label: '대화' })
  assert.deepEqual(mobileBackLink('/c/general/files'), { href: '/c/general', label: '대화' })
  assert.deepEqual(mobileBackLink('/dm/abc/shared'), { href: '/dm/abc', label: '대화' })
  assert.deepEqual(mobileBackLink('/files/xyz'), { href: '/files', label: '목록' })
  for (const p of ['/chat', '/inbox', '/tasks', '/files', '/search', '/settings', '/chatter']) {
    assert.equal(mobileBackLink(p), null, p)
  }
})
