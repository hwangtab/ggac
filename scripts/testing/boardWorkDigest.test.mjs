import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 이사회 업무툴 멘션·DM 메일 다이제스트(5단계) 순수 규칙 — 원본 kosmart-work `digest_candidates`(0027·0047)·
 * `lib/digest/{build,resend,run}.ts`. **실제 메일은 한 통도 나가지 않는다**: 발송 수단은 captureMailer 또는
 * 가짜 fetch다. Resend 주소로 요청이 나가는 경로는 가짜 fetch가 받아 세기만 한다.
 */

const { selectDigestRows, isDueForDigest, groupByRecipient, latestCreatedAt } = await import(
  '../../src/work/lib/digest/select.ts'
)
const { buildDigestEmail, snippetOf } = await import('../../src/work/lib/digest/build.ts')
const { captureMailer, classifyResendStatus, digestMailerFromEnv, resendMailer } = await import(
  '../../src/work/lib/digest/mailer.ts'
)

const NOW = new Date('2026-11-04T03:00:00Z') // 서울 수요일 12:00
const minAgo = m => new Date(NOW.getTime() - m * 60_000)

const row = (extra = {}) => ({
  recipient_id: 'u1',
  kind: 'mention',
  message_id: crypto.randomUUID(),
  parent_id: null,
  message_kind: 'text',
  channel_id: '22222222-2222-4222-8222-222222222222',
  channel_name: '이사회',
  channel_slug: 'board',
  channel_kind: 'public',
  author_name: '김이사',
  body: '확인 부탁드립니다',
  sensitive: false,
  created_at: minAgo(30),
  recipient_digest_mode: 'normal',
  recipient_quiet: null,
  ...extra,
})

// ── 고르기 ───────────────────────────────────────────────────────────────────

test('digest_mode: off(기본)는 보내지 않는다 · normal은 10분 · hourly는 60분 넘은 것만', () => {
  assert.equal(isDueForDigest(row({ recipient_digest_mode: 'off' }), NOW), false)
  assert.equal(isDueForDigest(row({ created_at: minAgo(9) }), NOW), false)
  assert.equal(isDueForDigest(row({ created_at: minAgo(10) }), NOW), true)
  assert.equal(
    isDueForDigest(row({ recipient_digest_mode: 'hourly', created_at: minAgo(59) }), NOW),
    false
  )
  assert.equal(
    isDueForDigest(row({ recipient_digest_mode: 'hourly', created_at: minAgo(60) }), NOW),
    true
  )
  assert.equal(isDueForDigest(row({ recipient_digest_mode: '이상한값' }), NOW), false)
})

test('읽을 수 없는 내용은 고르지 않는다: canAccess가 거짓인 행(이사에서 빠짐·비멤버)은 빠진다', () => {
  const readable = row({ message_id: 'ok' })
  const unreadable = row({ message_id: 'secret', channel_kind: 'private' })
  const out = selectDigestRows({
    rows: [readable, unreadable],
    now: NOW,
    canAccess: r => r.message_id !== 'secret',
  })
  assert.deepEqual(
    out.map(r => r.message_id),
    ['ok']
  )
})

test('방해 금지 시간인 사람은 이번 실행에서 빠진다(서울 기준 자정 넘는 구간·주말) — 짝: 평일 낮엔 나간다', () => {
  const quiet = { enabled: true, start: 22 * 60, end: 8 * 60, weekends: true }
  const r = row({ recipient_quiet: quiet })
  const pick = now =>
    selectDigestRows({
      rows: [{ ...r, created_at: new Date(now.getTime() - 3600_000) }],
      now,
      canAccess: () => true,
    })
  assert.equal(pick(new Date('2026-11-04T14:30:00Z')).length, 0) // 서울 23:30
  assert.equal(pick(new Date('2026-11-04T20:00:00Z')).length, 0) // 서울 05:00
  assert.equal(pick(new Date('2026-11-07T03:00:00Z')).length, 0) // 서울 토요일 12:00
  assert.equal(pick(NOW).length, 1)
})

test('받는 사람별로 묶고, 새 발송 기준은 담긴 메시지 중 가장 늦은 시각(지금이 아니다)', () => {
  const a1 = row({ recipient_id: 'a', created_at: minAgo(50) })
  const a2 = row({ recipient_id: 'a', created_at: minAgo(20) })
  const b1 = row({ recipient_id: 'b', created_at: minAgo(40) })
  const g = groupByRecipient([a1, b1, a2])
  assert.deepEqual([...g.keys()], ['a', 'b'])
  assert.equal(g.get('a').length, 2)
  assert.equal(latestCreatedAt(g.get('a')).getTime(), minAgo(20).getTime())
})

// ── 메일 본문 ─────────────────────────────────────────────────────────────────

test('메일: 제목에 건수, 링크는 /board-room, 민감 메시지는 본문 대신 안내 문구', () => {
  const mail = buildDigestEmail(
    [
      row({ body: '**안건** 확인' }),
      row({
        kind: 'dm',
        channel_kind: 'dm',
        channel_name: 'dm',
        body: '계좌 123-456',
        sensitive: true,
      }),
    ],
    'https://ggac.kr/'
  )
  assert.equal(mail.subject, '[이사회 업무] 읽지 않은 멘션 1건 · 다이렉트 메시지 1건')
  assert.equal(mail.count, 2)
  assert.match(mail.html, /https:\/\/ggac\.kr\/board-room\/c\/board#msg-/)
  assert.match(mail.html, /https:\/\/ggac\.kr\/board-room\/dm\//)
  assert.equal(mail.html.includes('123-456'), false)
  assert.equal(mail.text.includes('123-456'), false)
  assert.match(mail.text, /board-room\/settings\/notifications/)
})

test('메일: 본문·이름·채널 이름은 HTML 이스케이프한다(주입 불가)', () => {
  const mail = buildDigestEmail(
    [
      row({
        body: '<img src=x onerror=alert(1)>',
        author_name: '<b>나쁜</b>',
        channel_name: '"><script>',
      }),
    ],
    'https://ggac.kr'
  )
  assert.equal(mail.html.includes('<img src=x'), false)
  assert.equal(mail.html.includes('<script>'), false)
  assert.equal(mail.html.includes('<b>나쁜'), false)
})

test('메일: 20건까지만 싣고 나머지는 "외 n건", 스니펫은 140자', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row({ body: `${i} ${'가'.repeat(200)}` }))
  const mail = buildDigestEmail(rows, 'https://ggac.kr')
  assert.match(mail.html, /외 5건/)
  assert.equal((mail.html.match(/메시지 열기/g) ?? []).length, 20)
  assert.equal(snippetOf({ body: '가'.repeat(200), sensitive: false }).length, 141)
  assert.equal(buildDigestEmail([], 'https://ggac.kr'), null)
})

// ── 발송 수단 ─────────────────────────────────────────────────────────────────

test('captureMailer: 보내지 않고 쌓기만 한다', async () => {
  const sink = []
  const send = captureMailer(sink)
  assert.deepEqual(await send({ to: 'a@example.invalid', subject: 's', html: 'h', text: 't' }), {
    ok: true,
  })
  assert.equal(sink.length, 1)
})

test('Resend 상태 분류: 429 rate_limited · 400/422 rejected · 401/403 unauthorized · 그 밖 send_failed', () => {
  assert.deepEqual(classifyResendStatus(200), { ok: true })
  assert.equal(classifyResendStatus(429).reason, 'rate_limited')
  assert.equal(classifyResendStatus(422).reason, 'rejected')
  assert.equal(classifyResendStatus(400).reason, 'rejected')
  assert.equal(classifyResendStatus(403).reason, 'unauthorized')
  assert.equal(classifyResendStatus(502).reason, 'send_failed')
})

test('resendMailer: 가짜 fetch로 요청 모양만 본다(키는 헤더에만, 본문에 text·html·from)', async () => {
  const seen = []
  const fakeFetch = async (url, init) => {
    seen.push({ url, init })
    return new Response('{}', { status: 200 })
  }
  const send = resendMailer('re_test_key', { fetchImpl: fakeFetch })
  const res = await send({ to: 'a@example.invalid', subject: 's', html: '<p>h</p>', text: 't' })
  assert.deepEqual(res, { ok: true })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.resend.com/emails')
  assert.equal(seen[0].init.headers.Authorization, 'Bearer re_test_key')
  const body = JSON.parse(seen[0].init.body)
  assert.deepEqual(body.to, ['a@example.invalid'])
  assert.equal(body.text, 't')
  assert.equal(JSON.stringify(body).includes('re_test_key'), false)
  // 실패도 던지지 않고 분류한다
  const failing = resendMailer('k', { fetchImpl: async () => new Response('', { status: 429 }) })
  assert.equal(
    (await failing({ to: 'a@x.invalid', subject: '', html: '', text: '' })).reason,
    'rate_limited'
  )
  const broken = resendMailer('k', {
    fetchImpl: async () => {
      throw new Error('network')
    },
  })
  assert.equal(
    (await broken({ to: 'a@x.invalid', subject: '', html: '', text: '' })).reason,
    'send_failed'
  )
})

test('digestMailerFromEnv: 키가 없으면 null(건너뜀), log 모드는 보내지 않는다, 운영(VERCEL_ENV=production)에서는 log를 무시한다', async () => {
  assert.equal(digestMailerFromEnv({}), null)
  assert.equal(digestMailerFromEnv({ RESEND_API_KEY: '   ' }), null)
  const logOnly = digestMailerFromEnv({ BOARD_WORK_DIGEST_TRANSPORT: 'log', RESEND_API_KEY: '' })
  assert.equal(typeof logOnly, 'function')
  // log 모드는 fetch를 부르지 않는다 — 전역 fetch를 잠시 막아 확인한다
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = async () => {
    fetched++
    throw new Error('network must not be used')
  }
  try {
    assert.deepEqual(await logOnly({ to: 'a@x.invalid', subject: 's', html: 'h', text: 't' }), {
      ok: true,
    })
    // E2E 서버 조합(빈 키 + log)에서 키가 있어도 log가 이긴다
    const both = digestMailerFromEnv({ BOARD_WORK_DIGEST_TRANSPORT: 'log', RESEND_API_KEY: 're_x' })
    await both({ to: 'a@x.invalid', subject: 's', html: 'h', text: 't' })
    assert.equal(fetched, 0)
  } finally {
    globalThis.fetch = realFetch
  }
  // 운영 배포에서는 log 설정이 있어도 실제 발송 경로(키가 없으면 null)
  assert.equal(
    digestMailerFromEnv({ BOARD_WORK_DIGEST_TRANSPORT: 'log', VERCEL_ENV: 'production' }),
    null
  )
})
