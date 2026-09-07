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

/**
 * 리뷰 지적: 이 테스트가 예전에는 실제 운영 비공개 Blob 저장소에 썼다(4바이트
 * 파일 셋이 실제로 남아 국장이 손으로 지웠다). 이제는 `putObject`를 스텁으로
 * 주입해 Blob 호출을 가로챈다 — 저장소에는 아무것도 안 남고, pathname·바이트가
 * 올바른지는 여전히 단언한다.
 */
function stubPutObject(calls) {
  return async (store, pathname, body, contentType) => {
    calls.push({ store, pathname, body, contentType })
    return { url: `https://stub.blob.vercel-storage.com/${pathname}`, pathname }
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

// 리뷰 룰링(컨트롤러): 본문 조회 실패는 'pending'으로 남아야 한다. 'failed'로
// 옮기면 Task 7의 유일한 복구 쿼리(listPendingInboundEmails)가 'pending'만
// 읽어 이 행을 영영 못 본다. 예전 단언(assert.notEqual(..., 'done'))은
// 'failed'에서도 통과해 이 결함을 못 잡았다 — 'pending'과 동등한지로 조인다.
test('본문 조회가 실패해도 던지지 않고 pending으로 남긴다', async () => {
  const row = await seed()
  const restore = stubFetch(async () => new Response('nope', { status: 500 }))
  try {
    await ingestInboundEmail('x', row.id)
    const after = await getInboundEmail(row.id)
    assert.equal(after.body_fetch_status, 'pending')
  } finally {
    restore()
  }
})

test('첨부는 행으로 남고 blob_path가 mailbox/ 아래다', async () => {
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
  const putObjectCalls = []
  try {
    await ingestInboundEmail('x', row.id, { putObject: stubPutObject(putObjectCalls) })

    const attachments = await listAttachmentsForEmail(row.id)
    assert.equal(attachments.length, 1)
    assert.match(attachments[0].blob_path, /^mailbox\//)
    assert.equal(attachments[0].filename, 'report.pdf')

    // putObject가 실제로 한 번, 올바른 store·경로·바이트로 불렸는지 — 행의
    // blob_path와 attachmentId가 스텁이 받은 pathname과 같아야 한다.
    assert.equal(putObjectCalls.length, 1)
    assert.equal(putObjectCalls[0].store, 'private')
    assert.equal(putObjectCalls[0].pathname, attachments[0].blob_path)
    assert.match(putObjectCalls[0].pathname, new RegExp(`^mailbox/${row.id}/[^/]+\\.pdf$`))
    assert.deepEqual([...putObjectCalls[0].body], [1, 2, 3, 4])
  } finally {
    restore()
  }
})

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
    await ingestInboundEmail('x', row.id, { putObject: stubPutObject([]) })
    const after = await getInboundEmail(row.id)
    assert.equal(after.body_fetch_status, 'done')
    const attachments = await listAttachmentsForEmail(row.id)
    assert.equal(attachments.length, 0)
  } finally {
    restore()
  }
})

/**
 * Content-Length가 거짓일 수 있어서(또는 아예 없어서) downloadAttachment에는
 * 사후 버퍼 크기 검사가 따로 있다. content-length 헤더 없이 스트리밍 응답으로
 * 25MB를 넘겨 그 분기를 실제로 친다 — 이게 적대적인 경우(헤더를 속이거나
 * 생략하는 쪽)를 막는 검사다.
 */
function oversizedStream(totalBytes) {
  const chunkSize = 1024 * 1024
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkSize, totalBytes - sent)
      controller.enqueue(new Uint8Array(size))
      sent += size
    },
  })
}

test('content-length가 없어도 사후 버퍼 크기 검사가 25MB 초과를 막는다', async () => {
  const row = await seed()
  const restore = stubFetch(async url => {
    const target = String(url)
    if (target.includes('/attachments')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'att_stream',
              filename: 'stream.bin',
              content_type: 'application/octet-stream',
              content_id: null,
              size: null,
              download_url: 'https://inbound-cdn.resend.com/att_stream',
            },
          ],
        }),
        { status: 200 }
      )
    }
    if (target.startsWith('https://inbound-cdn.resend.com/')) {
      // content-length 헤더를 아예 주지 않는다 — 스트리밍 응답이라 자동으로도
      // 안 붙는다. downloadAttachment는 헤더가 없으면 사전 검사를 건너뛰고
      // 실제 버퍼를 다 읽은 뒤 크기를 재본다.
      const response = new Response(oversizedStream(26 * 1024 * 1024), { status: 200 })
      assert.equal(response.headers.get('content-length'), null)
      return response
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
    await ingestInboundEmail('x', row.id, { putObject: stubPutObject([]) })
    const after = await getInboundEmail(row.id)
    assert.equal(after.body_fetch_status, 'done')
    const attachments = await listAttachmentsForEmail(row.id)
    assert.equal(attachments.length, 0)
  } finally {
    restore()
  }
})
