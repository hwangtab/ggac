import { test } from 'node:test'
import assert from 'node:assert/strict'

const { isBoardWorkPath, BOARD_WORK_HOME } = await import('../../src/lib/boardWork/paths.ts')

// 이 판정은 두 레이아웃(ConditionalLayout·board-room/layout)이 같이 쓴다. 한쪽만 업무툴로 보면
// 이사회실 메뉴가 앱 셸 안에 끼거나, 전역 내비가 앱 셸 위에 겹친다.

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
