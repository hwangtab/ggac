import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  replyRecipients,
  replySubject,
  buildReplyQuote,
  QUOTE_MAX_CHARS,
} from '../../src/lib/mail/replyCompose.ts'
import { COMPOSE_LIMITS } from '../../src/lib/mail/composeValidation.ts'

const base = {
  from_address: '홍길동 <Hong@A.org>',
  to_addresses: JSON.stringify(['contact@ggac.kr']),
  cc_addresses: JSON.stringify([]),
  received_for: JSON.stringify(['contact@ggac.kr']),
}

test('Reply-To가 없으면 보낸 사람에게 답한다 — 주소는 소문자 순수 주소', () => {
  assert.deepEqual(replyRecipients(base, { all: false }), {
    to: 'hong@a.org',
    cc: [],
    dropped: [],
    recipientCount: 1,
  })
})

test('Reply-To가 있으면 그 첫 주소로 답한다 — 적힌 순서를 지킨다', () => {
  const r = replyRecipients(
    { ...base, headers: { 'reply-to': 'list@l.org, "Kim, M" <kim@b.org>' } },
    { all: false }
  )
  assert.equal(r.to, 'list@l.org')
  const mixed = replyRecipients(
    { ...base, headers: JSON.stringify({ 'Reply-To': '창구 <desk@c.org>, x@d.org' }) },
    { all: false }
  )
  assert.equal(mixed.to, 'desk@c.org')
})

test('전체 답장: 원본의 받는 사람·참조와 Reply-To의 나머지를 참조로, 우리 주소·받는 사람·중복은 뺀다', () => {
  const r = replyRecipients(
    {
      ...base,
      headers: { 'reply-to': 'desk@c.org, team@c.org' },
      to_addresses: JSON.stringify(['contact@ggac.kr', '동료 <Peer@A.org>']),
      cc_addresses: JSON.stringify(['peer@a.org', 'desk@c.org', 'info@ggac.kr']),
    },
    { all: true, ownAddresses: ['info@ggac.kr'] }
  )
  assert.equal(r.to, 'desk@c.org')
  assert.deepEqual(r.cc, ['team@c.org', 'peer@a.org'])
  assert.equal(r.recipientCount, 3)
})

test('전체 답장이 아니면 참조가 없다', () => {
  const r = replyRecipients(
    { ...base, cc_addresses: JSON.stringify(['peer@a.org']) },
    { all: false }
  )
  assert.deepEqual(r.cc, [])
})

test(`전체 답장 참조는 ${COMPOSE_LIMITS.maxCc}명까지, 형식이 틀린 주소와 넘친 주소는 dropped로 알린다`, () => {
  const many = Array.from({ length: COMPOSE_LIMITS.maxCc + 2 }, (_, i) => `p${i}@a.org`)
  const r = replyRecipients(
    { ...base, cc_addresses: JSON.stringify(['bad@@x.org', ...many]) },
    { all: true }
  )
  assert.equal(r.cc.length, COMPOSE_LIMITS.maxCc)
  assert.deepEqual(r.dropped, ['bad@@x.org', ...many.slice(COMPOSE_LIMITS.maxCc)])
})

test('@test.local은 받는 사람이어도 한도에 세지 않는다', () => {
  const r = replyRecipients(
    {
      ...base,
      from_address: 'a@x.test.local',
      cc_addresses: JSON.stringify(['real@a.org', 'b@test.local']),
    },
    { all: true }
  )
  assert.equal(r.recipientCount, 1)
})

test('받는 사람 주소를 알 수 없으면 null이다', () => {
  assert.equal(replyRecipients({ ...base, from_address: '이름만' }, { all: false }), null)
  assert.equal(replyRecipients({ ...base, from_address: '' }, { all: false }), null)
})

test('깨진 JSON·이상한 값이 와도 던지지 않는다', () => {
  const r = replyRecipients(
    {
      from_address: 'a@b.org',
      headers: '{broken',
      to_addresses: '[',
      cc_addresses: 42,
      received_for: null,
    },
    { all: true }
  )
  assert.deepEqual(r, { to: 'a@b.org', cc: [], dropped: [], recipientCount: 1 })
})

test('제목에는 Re:를 한 번만 붙인다', () => {
  assert.equal(replySubject('문의'), 'Re: 문의')
  assert.equal(replySubject('Re: 문의'), 'Re: 문의')
  assert.equal(replySubject('RE:문의'), 'RE:문의')
  assert.equal(replySubject('회신: 문의'), '회신: 문의')
  assert.equal(replySubject(null), 'Re: (제목 없음)')
  assert.equal(replySubject('  '), 'Re: (제목 없음)')
})

test('인용은 평문을 이스케이프하고 줄바꿈을 지키며 서울 시각으로 머리말을 단다', () => {
  const quote = buildReplyQuote({
    from_address: '홍 <a@b.org>',
    received_at: '2026-11-05T06:00:00Z',
    body_text: '첫 줄\r\n<script>alert(1)</script>',
  })
  assert.match(quote, /2026년 11월 5일 오후 03:00, 홍 &lt;a@b\.org&gt; 님이 작성:/)
  assert.match(
    quote,
    /<blockquote[^>]*>첫 줄<br>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/blockquote>/
  )
  assert.doesNotMatch(quote, /<script>/)
})

test('평문이 없으면 인용하지 않는다 — 받은 HTML은 다시 내보내지 않는다', () => {
  assert.equal(buildReplyQuote({ from_address: 'a@b', received_at: null, body_text: '' }), null)
  assert.equal(buildReplyQuote({ from_address: 'a@b', received_at: null, body_text: null }), null)
})

test(`긴 원문은 ${QUOTE_MAX_CHARS}자에서 자르고 생략 표시를 단다`, () => {
  const quote = buildReplyQuote({
    from_address: 'a@b',
    received_at: null,
    body_text: 'x'.repeat(QUOTE_MAX_CHARS + 500),
  })
  assert.ok(quote.includes('…(이하 생략)'))
  assert.ok(!quote.includes('x'.repeat(QUOTE_MAX_CHARS + 1)))
})
