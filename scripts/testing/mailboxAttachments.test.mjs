import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAILBOX_ATTACHMENT_PREFIX,
  blobPathForAttachment,
  isSafeMailboxAttachmentPath,
  contentDispositionAttachment,
} from '../../src/lib/storage/mailboxAttachments.ts'

const EMAIL = '0f9b1c3a-1111-4222-8333-444455556666'
const ATT = 'aa11bb22-3333-4444-8555-666677778888'

test('경로는 접두어 아래 세 조각이다', () => {
  const p = blobPathForAttachment(EMAIL, ATT, 'report.pdf')
  assert.equal(p, `${MAILBOX_ATTACHMENT_PREFIX}/${EMAIL}/${ATT}.pdf`)
  assert.equal(isSafeMailboxAttachmentPath(p), true)
})

test('확장자가 없으면 붙이지 않는다', () => {
  assert.equal(
    blobPathForAttachment(EMAIL, ATT, 'noext'),
    `${MAILBOX_ATTACHMENT_PREFIX}/${EMAIL}/${ATT}`
  )
})

test('파일명이 경로를 바꾸지 못한다 — 확장자만 쓴다', () => {
  const p = blobPathForAttachment(EMAIL, ATT, '../../backups/dump.sql')
  assert.equal(p, `${MAILBOX_ATTACHMENT_PREFIX}/${EMAIL}/${ATT}.sql`)
  assert.equal(isSafeMailboxAttachmentPath(p), true)
})

test('확장자가 이상하면 통째로 버린다', () => {
  assert.equal(
    blobPathForAttachment(EMAIL, ATT, 'x.a/b'),
    `${MAILBOX_ATTACHMENT_PREFIX}/${EMAIL}/${ATT}`
  )
  assert.equal(
    blobPathForAttachment(EMAIL, ATT, 'x.' + 'z'.repeat(20)),
    `${MAILBOX_ATTACHMENT_PREFIX}/${EMAIL}/${ATT}`
  )
})

test('다른 접두어를 거부한다 — DB 덤프가 같은 저장소에 산다', () => {
  assert.equal(isSafeMailboxAttachmentPath('backups/dump.sql'), false)
  assert.equal(isSafeMailboxAttachmentPath('board-documents/x/y.pdf'), false)
  assert.equal(isSafeMailboxAttachmentPath(`${MAILBOX_ATTACHMENT_PREFIX}x/a/b`), false)
})

test('경로 이탈을 거부한다', () => {
  for (const bad of [
    `${MAILBOX_ATTACHMENT_PREFIX}/../backups/dump.sql`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/../../x`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/b/c`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a`,
    `/${MAILBOX_ATTACHMENT_PREFIX}/a/b`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a\\b/c`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/%2e%2e`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/b?x=1`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/b#x`,
    `https://example.com/${MAILBOX_ATTACHMENT_PREFIX}/a/b`,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/b `,
    `${MAILBOX_ATTACHMENT_PREFIX}/a/b\u0000`,
    '',
  ]) {
    assert.equal(
      isSafeMailboxAttachmentPath(bad),
      false,
      `허용되면 안 된다: ${JSON.stringify(bad)}`
    )
  }
})

test('파일명은 헤더에 안전한 형태로 나간다', () => {
  const header = contentDispositionAttachment('보고서 "최종".pdf')
  assert.match(header, /^attachment; filename="/)
  assert.match(header, /filename\*=UTF-8''/)
  assert.equal(header.includes('\n'), false)
  assert.equal(header.includes('"최종"'), false)
})

test('헤더 인젝션을 막는다', () => {
  const header = contentDispositionAttachment('a\r\nX-Evil: 1.pdf')
  assert.equal(header.includes('\r'), false)
  assert.equal(header.includes('\n'), false)
})

test('비문자열 파일명은 안전하게 처리한다', () => {
  const headerUndefined = contentDispositionAttachment(undefined)
  assert.match(headerUndefined, /^attachment; filename="download"/)
  const headerNull = contentDispositionAttachment(null)
  assert.match(headerNull, /^attachment; filename="download"/)
})

test('빈 파일명도 안전하게 처리한다', () => {
  const header = contentDispositionAttachment('')
  assert.match(header, /^attachment; filename="download"/)
  assert.equal(header.includes('\n'), false)
})
