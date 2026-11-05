import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  isBoardWorkPath,
  isBoardWorkEditPath,
  boardMenuKey,
  BOARD_WORK_HOME,
  BOARD_MENU_GROUPS,
  BOARD_MENU_SETTINGS,
} = await import('../../src/lib/boardWork/paths.ts')

// 이 판정은 이사회실 레이아웃(board-room/layout)이 쓴다 — 업무 화면의 폭 정책, 이사 메뉴의 묶음·활성 항목,
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

test('이사 메뉴 활성 항목: 채널·DM·채널 찾아보기는 대화, 서류함은 자료실, 검색·편집은 없음', () => {
  const cases = [
    ['/board-room', 'dashboard'],
    ['/board-room/', 'dashboard'],
    ['/en/board-room', 'dashboard'],
    ['/board-room/meetings', 'meetings'],
    ['/board-room/meetings/1/edit', 'meetings'],
    ['/board-room/schedule', 'schedule'],
    ['/board-room/assembly', 'assembly'],
    ['/board-room/charter', 'charter'],
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
    ['/board-room/mailbox', 'mailbox'],
    ['/board-room/tasks?view=all', 'tasks'],
    ['/board-room/files', 'files'],
    ['/board-room/files?board=정관', 'files'],
    ['/board-room/files/7d0c8f7e-0000-4000-8000-000000000000', 'files'],
    ['/board-room/documents', 'files'],
    ['/en/board-room/documents', 'files'],
    ['/board-room/timebank', 'timebank'],
    ['/board-room/settings', 'settings'],
    ['/board-room/settings/notifications', 'settings'],
  ]
  for (const [p, key] of cases) assert.equal(boardMenuKey(p), key, p)
  for (const p of [
    '/board-room/search',
    '/board-room/search?q=정관',
    '/board-room/edit/123',
    '/board-room/chatter',
    '/board-roomchat',
    '/board',
    '',
    null,
  ]) {
    assert.equal(boardMenuKey(p), null, String(p))
  }
})

test('이사 메뉴 묶음: 대시보드 / 이사회 / 소통 / 업무 / 설정 — 검색·서류함은 메뉴에 없다', () => {
  assert.deepEqual(
    BOARD_MENU_GROUPS.map(g => [g.label, g.items.map(i => i.label)]),
    [
      [null, ['대시보드']],
      ['이사회', ['이사회 회의', '일정 투표', '정기총회', '정관']],
      ['소통', ['대화', '활동', '메일함']],
      ['업무', ['할 일', '자료실', '타임뱅크 보고']],
    ]
  )
  assert.equal(BOARD_MENU_SETTINGS.label, '설정')
  const all = [...BOARD_MENU_GROUPS.flatMap(g => g.items), BOARD_MENU_SETTINGS]
  // 각 href는 자기 항목으로 판정된다(활성 표시가 어긋나지 않는다)
  for (const item of all) assert.equal(boardMenuKey(item.href), item.key, item.href)
  assert.equal(new Set(all.map(i => i.key)).size, all.length)
  for (const banned of ['검색', '서류함', '업무 설정', '업무툴']) {
    assert.ok(!all.some(i => i.label.includes(banned)), banned)
  }
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

test('이사회 서류 앱 편집 화면도 편집 화면이다(메뉴 접기) — 업무 화면은 아니고 메뉴는 자료실', () => {
  const id = '7d0c8f7e-0000-4000-8000-000000000000'
  for (const p of [
    `/board-room/documents/${id}/edit`,
    `/board-room/documents/${id}/edit/`,
    `/en/board-room/documents/${id}/edit`,
    `/board-room/documents/${id}/edit?from=files`,
  ]) {
    assert.equal(isBoardWorkEditPath(p), true, p)
    assert.equal(isBoardWorkPath(p), false, p)
    assert.equal(boardMenuKey(p), 'files', p)
  }
  for (const p of [
    '/board-room/documents',
    `/board-room/documents/${id}`,
    `/board-room/documents/${id}/editor`,
    `/board-room/documents/${id}/edit/x`,
    '/board-room/documents//edit',
    `/board-room/meetings/${id}/edit`,
  ]) {
    assert.equal(isBoardWorkEditPath(p), false, p)
  }
})
