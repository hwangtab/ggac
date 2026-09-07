import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TURSO_DATABASE_URL = 'file:local.db'
process.env.RESEND_INBOUND_API_KEY = 'test-key'

const { ingestInboundEmail } = await import('../../src/lib/mail/ingestInbound.ts')
const { insertInboundEmail, getInboundEmail, listAttachmentsForEmail } = await import(
  '../../src/db/queries/mailbox.ts'
)

function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = original
  }
}

function seed() {
  return insertInboundEmail({
    resend_email_id: `re_${Math.random().toString(36).slice(2)}`,
    message_id: '<abc@mail.example.com>',
    from_address: 'sender@example.com',
    to_addresses: ['contact@ggac.kr'],
    received_for: ['contact@ggac.kr'],
    subject: '문의',
    received_at: new Date(),
  })
}

test('본문을 당겨 저장하면 done이 된다', async () => {
  const row = await seed()
  const restore = stubFetch(async url => {
    if (String(url).includes('/attachments')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }
    return new Response(
      JSON.stringify({
        id: 'x',
        from: 'sender@example.com',
        to: ['contact@ggac.kr'],
        html: '<p>본문</p>',
        text: '본문',
        headers: {},
      }),
      { status: 200 }
    )
  })
  try {
    await ingestInboundEmail('x', row.id)
    const after = await getInboundEmail(row.id)
    assert.equal(after.body_fetch_status, 'done')
    assert.equal(after.body_html, '<p>본문</p>')
  } finally {
    restore()
  }
})

test('본문 조회가 실패해도 던지지 않고 pending으로 남긴다', async () => {
  const row = await seed()
  const restore = stubFetch(async () => new Response('nope', { status: 500 }))
  try {
    await ingestInboundEmail('x', row.id)
    const after = await getInboundEmail(row.id)
    assert.notEqual(after.body_fetch_status, 'done')
  } finally {
    restore()
  }
})

// 이 테스트는 Blob에 실제로 쓴다. PRIVATE_BLOB_READ_WRITE_TOKEN이 없는 환경에서는
// 건너뛴다 — 실제 값 유무는 process.env로 판정하고, 있으면 실제 업로드를 검증한다.
const hasBlobCredentials = Boolean(process.env.PRIVATE_BLOB_READ_WRITE_TOKEN)

test(
  '첨부는 행으로 남고 blob_path가 mailbox/ 아래다',
  { skip: !hasBlobCredentials && 'PRIVATE_BLOB_READ_WRITE_TOKEN이 없어 건너뜀' },
  async () => {
    const row = await seed()
    const restore = stubFetch(async url => {
      const target = String(url)
      if (target.includes('/attachments')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'att_1',
                filename: 'report.pdf',
                content_type: 'application/pdf',
                content_id: null,
                size: 4,
                download_url: 'https://inbound-cdn.resend.com/att_1',
              },
            ],
          }),
          { status: 200 }
        )
      }
      if (target.startsWith('https://inbound-cdn.resend.com/')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
      }
      return new Response(
        JSON.stringify({ id: 'x', from: 'a@b.c', to: [], html: null, text: null, headers: {} }),
        { status: 200 }
      )
    })
    try {
      await ingestInboundEmail('x', row.id)
      const attachments = await listAttachmentsForEmail(row.id)
      assert.equal(attachments.length, 1)
      assert.match(attachments[0].blob_path, /^mailbox\//)
      assert.equal(attachments[0].filename, 'report.pdf')
    } finally {
      restore()
    }
  }
)

// Task 6 리뷰가 남긴 검증 공백: downloadAttachment의 사전 크기 검사(Content-Length)
// 분기를 친다. 25MB를 넘는 content-length를 스텁으로 주면 그 첨부만 건너뛰고
// 본문과 나머지는 저장돼야 한다. 첨부 행은 생기지 않아야 한다.
test('첨부가 25MB 상한을 넘으면 그 첨부만 건너뛰고 본문은 저장된다', async () => {
  const row = await seed()
  const restore = stubFetch(async url => {
    const target = String(url)
    if (target.includes('/attachments')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'att_big',
              filename: 'huge.zip',
              content_type: 'application/zip',
              content_id: null,
              size: 30 * 1024 * 1024,
              download_url: 'https://inbound-cdn.resend.com/att_big',
            },
          ],
        }),
        { status: 200 }
      )
    }
    if (target.startsWith('https://inbound-cdn.resend.com/')) {
      // 사전 Content-Length 검사 분기를 친다 — 실제 바이트를 보내기 전에
      // downloadAttachment가 헤더만 보고 던져야 한다.
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-length': String(30 * 1024 * 1024) },
      })
    }
    return new Response(
      JSON.stringify({
        id: 'x',
        from: 'sender@example.com',
        to: ['contact@ggac.kr'],
        html: '<p>본문</p>',
        text: '본문',
        headers: {},
      }),
      { status: 200 }
    )
  })
  try {
    await ingestInboundEmail('x', row.id)
    const after = await getInboundEmail(row.id)
    assert.equal(after.body_fetch_status, 'done')
    const attachments = await listAttachmentsForEmail(row.id)
    assert.equal(attachments.length, 0)
  } finally {
    restore()
  }
})
