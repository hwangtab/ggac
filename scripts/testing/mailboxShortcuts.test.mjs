import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mailboxShortcut, SHORTCUT_HELP } from '../../src/app/[locale]/admin/mailbox/shortcuts.ts'

const admin = { canManage: true, modalOpen: false }
const director = { canManage: false, modalOpen: false }
const key = (k, extra = {}) => ({ key: k, target: { tagName: 'BODY' }, ...extra })

test('Gmail과 같은 키를 동작으로 바꾼다', () => {
  assert.equal(mailboxShortcut(key('j'), admin), 'next')
  assert.equal(mailboxShortcut(key('k'), admin), 'prev')
  assert.equal(mailboxShortcut(key('Escape'), admin), 'close')
  assert.equal(mailboxShortcut(key('u'), admin), 'close')
  assert.equal(mailboxShortcut(key('/'), admin), 'search')
  assert.equal(mailboxShortcut(key('?'), admin), 'help')
  assert.equal(mailboxShortcut(key('e'), admin), 'archive')
  assert.equal(mailboxShortcut(key('!'), admin), 'spam')
  assert.equal(mailboxShortcut(key('r'), admin), 'reply')
  assert.equal(mailboxShortcut(key('a'), admin), 'reply-all')
  assert.equal(mailboxShortcut(key('f'), admin), 'forward')
  assert.equal(mailboxShortcut(key('x'), admin), 'toggle-select')
  assert.equal(mailboxShortcut(key('z'), admin), null)
})

test('글을 쓰는 중에는 아무것도 하지 않는다 — 입력창·글상자·고르기·편집 영역', () => {
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'textarea' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    assert.equal(mailboxShortcut(key('e', { target }), admin), null, JSON.stringify(target))
  }
})

test('조합 키(Ctrl·Cmd·Alt)나 다른 창이 열려 있으면 아무것도 하지 않는다 — 브라우저 단축키를 가로채지 않게', () => {
  assert.equal(mailboxShortcut(key('r', { metaKey: true }), admin), null)
  assert.equal(mailboxShortcut(key('f', { ctrlKey: true }), admin), null)
  assert.equal(mailboxShortcut(key('j', { altKey: true }), admin), null)
  assert.equal(mailboxShortcut(key('j'), { canManage: true, modalOpen: true }), null)
})

test('이사·감사에게는 읽기 키만 — 상태 바꾸기·답장·고르기는 관리자만이다', () => {
  for (const k of ['j', 'k', 'Escape', '/', '?']) {
    assert.notEqual(mailboxShortcut(key(k), director), null, k)
  }
  for (const k of ['e', '!', 'r', 'a', 'f', 'x']) {
    assert.equal(mailboxShortcut(key(k), director), null, k)
  }
})

test('도움말 목록은 판정 표와 같은 키를 보인다', () => {
  const shown = SHORTCUT_HELP.flatMap(item =>
    item.keys.split(' / ').map(k => (k === 'Esc' ? 'Escape' : k))
  )
  for (const k of shown) {
    assert.notEqual(mailboxShortcut(key(k), admin), null, `도움말의 ${k}가 판정 표에 없다`)
  }
})
