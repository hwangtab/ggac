import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchSentMessageId, isMessageId } from '../../src/lib/mail/sentMessageId.ts'

/**
 * 보낸 메일의 `Message-ID`를 Resend에 물어보는 부분 — 답장을 원래 메일에 **정확히** 잇는 근거다.
 *
 * 여기서 지키는 것: 이 함수는 절대 던지지 않는다(발송은 이미 끝났다). 형식이 아닌 값은 받지 않는다(헤더가 아닌
 * 값이 DB에 들어가면 대조가 조용히 빗나간다). 호출부가 준 fetch만 쓴다 — 단위 테스트가 실제 Resend를 부르지 않는다.
 */

function respond(body, init = {}) {
  return async () => new Response(JSON.stringify(body), { status: 200, ...init })
}

test('Resend가 준 message_id를 그대로 돌려준다', async () => {
  const value = await fetchSentMessageId('email-uuid', {
    apiKey: 're_test',
    fetch: respond({ id: 'email-uuid', message_id: '<111-222@email.example.com>' }),
  })
  assert.equal(value, '<111-222@email.example.com>')
})

test('키가 없으면 요청하지 않는다', async () => {
  let called = 0
  const value = await fetchSentMessageId('email-uuid', {
    apiKey: '',
    fetch: async () => {
      called += 1
      return new Response('{}')
    },
  })
  assert.equal(value, null)
  assert.equal(called, 0)
})

test('거절·시간 초과·깨진 JSON은 null이다 — 던지지 않는다', async () => {
  const failing = await fetchSentMessageId('x', {
    apiKey: 'k',
    fetch: async () => new Response('nope', { status: 404 }),
  })
  assert.equal(failing, null)

  const broken = await fetchSentMessageId('x', {
    apiKey: 'k',
    fetch: async () => new Response('not json'),
  })
  assert.equal(broken, null)

  const threw = await fetchSentMessageId('x', {
    apiKey: 'k',
    fetch: async () => {
      throw new Error('network')
    },
  })
  assert.equal(threw, null)
})

test('헤더가 아닌 값은 받지 않는다 — 꺾쇠와 @가 있는 형식만', async () => {
  for (const value of [
    '111-222@email.example.com',
    '<111-222>',
    '<a b@x>',
    '',
    null,
    42,
    '<>',
    '<a@>',
  ]) {
    const got = await fetchSentMessageId('x', {
      apiKey: 'k',
      fetch: respond({ message_id: value }),
    })
    assert.equal(got, null, String(value))
    assert.equal(isMessageId(value), false, String(value))
  }
  assert.equal(isMessageId('<a@b.c>'), true)
})
