import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MailSendError, sendEmail } from '../../src/lib/mail/send.ts'
import { sendAuthEmail } from '../../src/lib/auth/email.ts'

/** globalThis.fetch를 가로채 payload를 잡아둔다. */
function captureFetch(responseBody = '{}') {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
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

test('@test.local 수신자에게는 sendEmail·sendAuthEmail이 Resend를 호출하지 않는다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch()
  try {
    const id = await sendEmail({ to: 'authz-admin@test.local', subject: 's', html: '<p>x</p>' })
    await sendAuthEmail('recovery', 'Someone@Test.Local', 'https://ggac.kr/x')
    assert.equal(id, null)
    assert.equal(f.calls.length, 0)

    await sendEmail({ to: 'real@gmail.com', subject: 's', html: '<p>x</p>' })
    assert.equal(f.calls.length, 1)
  } finally {
    f.restore()
  }
})

test('여러 수신자·cc·bcc가 그대로 페이로드에 실린다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch()
  try {
    await sendEmail({
      to: ['a@x.com', 'b@x.com'],
      cc: ['c@x.com'],
      bcc: ['d@x.com'],
      subject: 's',
      html: '<p>x</p>',
    })
    assert.deepEqual(f.calls[0].body.to, ['a@x.com', 'b@x.com'])
    assert.deepEqual(f.calls[0].body.cc, ['c@x.com'])
    assert.deepEqual(f.calls[0].body.bcc, ['d@x.com'])
  } finally {
    f.restore()
  }
})

test('cc·bcc가 비어 있으면 키를 넣지 않는다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch()
  try {
    await sendEmail({ to: 'a@x.com', cc: [], bcc: [], subject: 's', html: '<p>x</p>' })
    assert.equal('cc' in f.calls[0].body, false)
    assert.equal('bcc' in f.calls[0].body, false)
    assert.equal('attachments' in f.calls[0].body, false)
    assert.equal('Idempotency-Key' in f.calls[0].headers, false)
  } finally {
    f.restore()
  }
})

test('첨부는 base64로, idempotencyKey는 Idempotency-Key 헤더로 나간다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch()
  try {
    await sendEmail({
      to: 'a@x.com',
      subject: 's',
      html: '<p>x</p>',
      attachments: [{ filename: '견적서.pdf', content: Buffer.from('hello') }],
      idempotencyKey: 'key-123',
    })
    assert.deepEqual(f.calls[0].body.attachments, [
      { filename: '견적서.pdf', content: Buffer.from('hello').toString('base64') },
    ])
    assert.equal(f.calls[0].headers['Idempotency-Key'], 'key-123')
  } finally {
    f.restore()
  }
})

test('to에서 @test.local만 걸러내고, 남는 수신자가 없으면 발송하지 않는다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const f = captureFetch()
  try {
    const none = await sendEmail({
      to: ['authz-admin@test.local', 'authz-owner@test.local'],
      cc: ['x@test.local'],
      subject: 's',
      html: '<p>x</p>',
    })
    assert.equal(none, null)
    assert.equal(f.calls.length, 0)

    await sendEmail({
      to: ['authz-admin@test.local', 'real@gmail.com'],
      cc: ['x@test.local'],
      subject: 's',
      html: '<p>x</p>',
    })
    assert.deepEqual(f.calls[0].body.to, ['real@gmail.com'])
    assert.equal('cc' in f.calls[0].body, false)
  } finally {
    f.restore()
  }
})

test('키가 없으면 kind=config로 던지고 요청을 보내지 않는다', async () => {
  delete process.env.RESEND_API_KEY
  const f = captureFetch()
  try {
    await assert.rejects(
      sendEmail({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
      e => e instanceof MailSendError && e.kind === 'config'
    )
    assert.equal(f.calls.length, 0)
  } finally {
    f.restore()
  }
})

test('HTTP 오류는 kind=rejected이고 메시지에 (상태코드)가 남는다 — grantPublishWiring 호환', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('rate limited', { status: 429 })
  try {
    await assert.rejects(
      sendEmail({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
      e =>
        e instanceof MailSendError &&
        e.kind === 'rejected' &&
        e.status === 429 &&
        e.message.includes('(429)') &&
        e instanceof Error
    )
  } finally {
    globalThis.fetch = original
  }
})

test('Resend 5xx·408은 안 나갔다고 단정할 수 없어 kind=unknown이다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const original = globalThis.fetch
  try {
    for (const status of [500, 502, 503, 504, 408]) {
      globalThis.fetch = async () => new Response('upstream', { status })
      await assert.rejects(
        sendEmail({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
        e => e instanceof MailSendError && e.kind === 'unknown' && e.status === status,
        String(status)
      )
    }
  } finally {
    globalThis.fetch = original
  }
})

test('Resend 4xx는 요청을 받아들이지 않은 것이라 kind=rejected다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const original = globalThis.fetch
  try {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      globalThis.fetch = async () => new Response('no', { status })
      await assert.rejects(
        sendEmail({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
        e =>
          e instanceof MailSendError && e.kind === 'rejected' && e.message.includes(`(${status})`),
        String(status)
      )
    }
  } finally {
    globalThis.fetch = original
  }
})

test('네트워크 오류·타임아웃은 kind=unknown이다 — 닿았는지 모른다', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  try {
    await assert.rejects(
      sendEmail({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
      e => e instanceof MailSendError && e.kind === 'unknown'
    )
  } finally {
    globalThis.fetch = original
  }
})
