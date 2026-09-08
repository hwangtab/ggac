import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendEmail } from '../../src/lib/mail/send.ts'
import { sendAuthEmail } from '../../src/lib/auth/email.ts'

/** globalThis.fetch를 가로채 payload를 잡아둔다. */
function captureFetch() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response('{}', { status: 200 })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

test('MAILBOX_REPLY_TO가 있으면 sendEmail이 reply_to를 붙인다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.MAILBOX_REPLY_TO = 'contact@ggac.kr'
  const f = captureFetch()
  try {
    await sendEmail({ to: 'a@example.com', subject: '제목', html: '<p>본문</p>' })
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].body.reply_to, ['contact@ggac.kr'])
  } finally {
    f.restore()
  }
})

test('MAILBOX_REPLY_TO가 없으면 reply_to 키 자체가 없다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  delete process.env.MAILBOX_REPLY_TO
  const f = captureFetch()
  try {
    await sendEmail({ to: 'a@example.com', subject: '제목', html: '<p>본문</p>' })
    assert.equal('reply_to' in f.calls[0].body, false)
  } finally {
    f.restore()
  }
})

test('인증 메일도 reply_to를 붙인다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.MAILBOX_REPLY_TO = 'contact@ggac.kr'
  const f = captureFetch()
  try {
    await sendAuthEmail('recovery', 'a@example.com', 'https://ggac.kr/reset?token=x')
    assert.deepEqual(f.calls[0].body.reply_to, ['contact@ggac.kr'])
  } finally {
    f.restore()
  }
})

test('공백만 든 MAILBOX_REPLY_TO는 없는 것으로 본다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.MAILBOX_REPLY_TO = '   '
  const f = captureFetch()
  try {
    await sendEmail({ to: 'a@example.com', subject: '제목', html: '<p>본문</p>' })
    assert.equal('reply_to' in f.calls[0].body, false)
  } finally {
    f.restore()
  }
})
