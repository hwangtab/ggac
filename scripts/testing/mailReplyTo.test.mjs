import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendEmail } from '../../src/lib/mail/send.ts'
import { sendAuthEmail } from '../../src/lib/auth/email.ts'

/** globalThis.fetch를 가로채 payload를 잡아둔다. */
function captureFetch(responseBody = '{}') {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(responseBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
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

test('sendEmail은 Resend가 매긴 메시지 식별자를 돌려준다', async () => {
  // 이 값이 없으면 보낸 답장과 Resend 대시보드의 한 줄을 맞춰 볼 수단이 없다.
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch('{"id":"re_abc123"}')
  try {
    const id = await sendEmail({ to: 'a@example.com', subject: '제목', html: '<p>본문</p>' })
    assert.equal(id, 're_abc123')
  } finally {
    f.restore()
  }
})

test('식별자를 읽지 못해도 발송은 성공으로 둔다', async () => {
  // 메일은 이미 나갔다. 응답 모양이 달라졌다고 던지면 관리자가 "실패"를 보고
  // 다시 눌러 같은 메일이 두 번 간다.
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch('not json')
  try {
    assert.equal(await sendEmail({ to: 'a@example.com', subject: '제목', html: '<p>x</p>' }), null)
  } finally {
    f.restore()
  }
})
