import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  isBoardWorkPath,
  isBoardWorkEditPath,
  boardWorkNavKey,
  BOARD_WORK_HOME,
  BOARD_WORK_NAV_ITEMS,
} = await import('../../src/lib/boardWork/paths.ts')

// 이 판정은 이사회실 레이아웃(board-room/layout)이 쓴다 — 업무 화면의 폭 정책, '업무' 묶음의 활성 항목,
// 편집 화면의 메뉴 접기(docs/board-work/03-통합-재설계.md §4-1).

test('업무툴 경로는 로케일 접두사와 무관하게 업무툴이다', () => {
  for (const p of [
    '/board-room/chat',
    '/board-room/c/general',
    '/board-room/dm/abc',
    '/board-room/inbox/mentions',
    '/board-room/tasks',
    '/board-room/tasks?view=today',
    '/board-room/c/general/t/7d0c8f7e-0000-4000-8000-000000000000',
    '/board-room/files',
    '/board-room/search?q=정관',
    '/board-room/settings/notifications',
    '/board-room/edit/123',
    '/en/board-room/chat',
    BOARD_WORK_HOME,
  ]) {
    assert.equal(isBoardWorkPath(p), true, p)
  }
})

test('기존 이사회실 화면은 업무툴이 아니다', () => {
  for (const p of [
    '/board-room',
    '/board-room/meetings',
    '/board-room/meetings/1/edit',
    '/board-room/documents',
    '/board-room/assembly',
    '/board-room/charter',
    '/board-room/mailbox',
    '/board-room/schedule',
    '/en/board-room/documents',
    '/board-roomchat',
    '/board-room/chatter',
    '/board-room/taskser',
    '/admin/board-room/chat',
    '/enx/board-room/chat',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isBoardWorkPath(p), false, String(p))
  }
})

test("'업무' 묶음 활성 항목: 채널·DM·채널 찾아보기는 '대화'다", () => {
  const cases = [
    ['/board-room/chat', 'chat'],
    ['/board-room/chat?new=1', 'chat'],
    ['/board-room/c', 'chat'],
    ['/board-room/c/general', 'chat'],
    ['/board-room/c/general/t/7d0c8f7e-0000-4000-8000-000000000000', 'chat'],
    ['/board-room/dm/abc', 'chat'],
    ['/board-room/dm/abc/shared', 'chat'],
    ['/en/board-room/dm/abc', 'chat'],
    ['/board-room/inbox', 'inbox'],
    ['/board-room/inbox/mentions', 'inbox'],
    ['/board-room/tasks?view=all', 'tasks'],
    ['/board-room/files', 'files'],
    ['/board-room/files/7d0c8f7e-0000-4000-8000-000000000000', 'files'],
    ['/board-room/search?q=정관', 'search'],
    ['/board-room/settings', 'settings'],
    ['/board-room/settings/notifications', 'settings'],
  ]
  for (const [p, key] of cases) assert.equal(boardWorkNavKey(p), key, p)
  for (const p of [
    '/board-room',
    '/board-room/meetings',
    '/board-room/mailbox',
    '/board-room/edit/123',
    '/board-room/chatter',
    '/board-roomchat',
    '',
    null,
  ]) {
    assert.equal(boardWorkNavKey(p), null, String(p))
  }
})

test("'업무' 묶음 항목은 활성 판정과 같은 키를 쓰고, 각 href는 자기 항목으로 판정된다", () => {
  assert.deepEqual(
    BOARD_WORK_NAV_ITEMS.map(i => i.label),
    ['대화', '활동', '할 일', '자료실', '검색', '업무 설정']
  )
  for (const item of BOARD_WORK_NAV_ITEMS) {
    assert.equal(boardWorkNavKey(item.href), item.key, item.href)
    assert.equal(isBoardWorkPath(item.href), true, item.href)
  }
  assert.ok(!BOARD_WORK_NAV_ITEMS.some(i => i.label.includes('업무툴')))
})

test('편집 화면 판정', () => {
  for (const p of [
    '/board-room/edit/123',
    '/board-room/edit/new?channel=x',
    '/en/board-room/edit/1',
  ]) {
    assert.equal(isBoardWorkEditPath(p), true, p)
  }
  for (const p of ['/board-room/files', '/board-room/editor', '/board-room', '/edit/1', null]) {
    assert.equal(isBoardWorkEditPath(p), false, String(p))
  }
})
