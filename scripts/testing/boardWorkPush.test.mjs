import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * 이사회 업무툴 웹 푸시(5단계) 순수 규칙 — 원본 kosmart-work `push_recipients`(0027)·`lib/push/*`·`public/sw.js`.
 * DB·네트워크 없이 본다: 수신자 규칙(알림 수준·뮤트·방해 금지·읽기 범위 재확인), endpoint 허용 목록·SSRF,
 * 페이로드 모양(본문 노출 범위), 발송 몸통(404·410 만료 분류 — 가짜 transport), 서비스 워커의 알림 클릭 주소 제한.
 * **실제 푸시는 한 건도 나가지 않는다**(transport는 모두 이 파일의 가짜다).
 */

const { selectPushRecipients, effectiveLevel, levelAllows, reasonApplies } = await import(
  '../../src/work/lib/push/recipients.ts'
)
const { isQuietNow } = await import('../../src/work/lib/notifications/quiet-hours.ts')
const { isAllowedPushEndpoint, isPublicPushHost, subscribeBodySchema, unsubscribeBodySchema } =
  await import('../../src/work/lib/push/subscription.ts')
const { buildPushPayload, pushUrl } = await import('../../src/work/lib/push/payload.ts')
const { deliverPush, isSendableEndpoint } = await import('../../src/work/lib/push/deliver.ts')
const { isPushSyncFresh, formatPushSyncMark } = await import('../../src/work/lib/push/device.ts')

// ── 방해 금지(Asia/Seoul) ────────────────────────────────────────────────────

/** 서울 시각 → Date(서울은 서머타임이 없다: UTC+9 고정) */
const seoul = iso => new Date(`${iso}+09:00`)

test('방해 금지: 자정을 넘는 구간 [22:00, 08:00) — 경계 포함·제외', () => {
  const p = { enabled: true, start: 22 * 60, end: 8 * 60, weekends: false }
  // 2026-11-04는 수요일
  assert.equal(isQuietNow(p, seoul('2026-11-04T21:59:00')), false)
  assert.equal(isQuietNow(p, seoul('2026-11-04T22:00:00')), true)
  assert.equal(isQuietNow(p, seoul('2026-11-04T23:59:00')), true)
  assert.equal(isQuietNow(p, seoul('2026-11-05T00:00:00')), true)
  assert.equal(isQuietNow(p, seoul('2026-11-05T07:59:00')), true)
  assert.equal(isQuietNow(p, seoul('2026-11-05T08:00:00')), false)
})

test('방해 금지: UTC가 아니라 서울 시각으로 판정한다(UTC 13:30 = 서울 22:30)', () => {
  const p = { enabled: true, start: 22 * 60, end: 8 * 60, weekends: false }
  assert.equal(isQuietNow(p, new Date('2026-11-04T13:30:00Z')), true)
  // UTC로는 22:30이지만 서울은 다음 날 07:30 → 아직 방해 금지
  assert.equal(isQuietNow(p, new Date('2026-11-04T22:30:00Z')), true)
  // UTC 23:30 = 서울 08:30 → 끝남
  assert.equal(isQuietNow(p, new Date('2026-11-04T23:30:00Z')), false)
})

test('방해 금지: 주말 종일 — 서울 기준 토·일(UTC로는 금요일 밤이어도 서울이 토요일이면 주말)', () => {
  const p = { enabled: true, start: 22 * 60, end: 8 * 60, weekends: true }
  // 2026-11-07 토요일 정오(서울)
  assert.equal(isQuietNow(p, seoul('2026-11-07T12:00:00')), true)
  // 2026-11-08 일요일 23시
  assert.equal(isQuietNow(p, seoul('2026-11-08T23:00:00')), true)
  // 금요일 UTC 16:00 = 서울 토요일 01:00 → 주말
  assert.equal(isQuietNow(p, new Date('2026-11-06T16:00:00Z')), true)
  // 월요일 정오는 평일 낮
  assert.equal(isQuietNow(p, seoul('2026-11-09T12:00:00')), false)
  // 주말 옵션이 꺼져 있으면 토요일 낮은 조용하지 않다
  assert.equal(isQuietNow({ ...p, weekends: false }, seoul('2026-11-07T12:00:00')), false)
})

test('방해 금지: 꺼져 있으면 언제나 거짓, 시작=끝이면 구간 없음', () => {
  assert.equal(
    isQuietNow(
      { enabled: false, start: 0, end: 1439, weekends: true },
      seoul('2026-11-07T12:00:00')
    ),
    false
  )
  assert.equal(
    isQuietNow(
      { enabled: true, start: 600, end: 600, weekends: false },
      seoul('2026-11-04T10:00:00')
    ),
    false
  )
  // 같은 날 구간 [09:00, 18:00)
  const day = { enabled: true, start: 9 * 60, end: 18 * 60, weekends: false }
  assert.equal(isQuietNow(day, seoul('2026-11-04T08:59:00')), false)
  assert.equal(isQuietNow(day, seoul('2026-11-04T09:00:00')), true)
  assert.equal(isQuietNow(day, seoul('2026-11-04T18:00:00')), false)
})

// ── 수신자 규칙 ──────────────────────────────────────────────────────────────

const WEEKDAY_NOON = seoul('2026-11-04T12:00:00')
const cand = (userId, extra = {}) => ({
  userId,
  memberRole: 'member',
  notifyLevel: null,
  quiet: null,
  mentioned: false,
  ...extra,
})
const all = () => true
const pick = (reason, message, candidates, opts = {}) =>
  selectPushRecipients({
    reason,
    message,
    candidates,
    canAccess: opts.canAccess ?? all,
    now: opts.now ?? WEEKDAY_NOON,
  })

const channelMsg = { authorId: 'author', channelKind: 'public', parentId: null }
const dmMsg = { authorId: 'author', channelKind: 'dm', parentId: null }
const replyMsg = { authorId: 'author', channelKind: 'private', parentId: 'parent' }

test('기본 알림 수준: 채널은 멘션만, DM·그룹은 모든 새 글', () => {
  assert.equal(effectiveLevel(null, 'public'), 'mentions')
  assert.equal(effectiveLevel(null, 'private'), 'mentions')
  assert.equal(effectiveLevel(null, 'dm'), 'all')
  assert.equal(effectiveLevel('off', 'dm'), 'off')
  assert.equal(effectiveLevel('이상한값', 'dm'), 'all')
})

test('사유가 메시지에 맞아야 한다: dm은 DM만, channel은 일반 채널 최상위 글만, thread는 답글만', () => {
  assert.equal(reasonApplies('dm', channelMsg), false)
  assert.equal(reasonApplies('dm', dmMsg), true)
  assert.equal(reasonApplies('channel', dmMsg), false)
  assert.equal(reasonApplies('channel', replyMsg), false)
  assert.equal(reasonApplies('channel', channelMsg), true)
  assert.equal(reasonApplies('thread', channelMsg), false)
  assert.equal(reasonApplies('thread', replyMsg), true)
  assert.deepEqual(pick('dm', channelMsg, [cand('a')]), [])
})

test('멘션: 끔(뮤트)만 빠지고 멘션만·모든 새 글은 받는다', () => {
  const r = pick('mention', channelMsg, [
    cand('off', { notifyLevel: 'off', mentioned: true }),
    cand('mentions', { notifyLevel: 'mentions', mentioned: true }),
    cand('all', { notifyLevel: 'all', mentioned: true }),
    cand('default', { mentioned: true }),
  ])
  assert.deepEqual(r, ['mentions', 'all', 'default'])
})

test('작성자 본인·채널 비멤버는 받지 않는다(관리자라도 멤버가 아니면 — 원본 join channel_members)', () => {
  const r = pick('mention', channelMsg, [
    cand('author', { mentioned: true }),
    cand('outsider', { memberRole: null, mentioned: true }),
    cand('member', { mentioned: true }),
  ])
  assert.deepEqual(r, ['member'])
})

test('읽기 범위·이사회 권한을 보내는 순간 다시 본다: canAccess가 거짓이면 다른 조건과 무관하게 뺀다', () => {
  const removedDirector = cand('ex-director', { notifyLevel: 'all', mentioned: true })
  const director = cand('director', { notifyLevel: 'all', mentioned: true })
  const seen = []
  const r = pick('mention', channelMsg, [removedDirector, director], {
    canAccess: c => {
      seen.push(c.userId)
      return c.userId !== 'ex-director'
    },
  })
  assert.deepEqual(r, ['director'])
  // 짝: 판정 함수가 후보마다 실제로 불렸다(건너뛰고 통과시키지 않는다)
  assert.deepEqual(seen.sort(), ['director', 'ex-director'])
})

test('DM: 기본·모든 새 글이면 받고, 멘션만이면 멘션됐을 때만, 끔이면 안 받는다', () => {
  const r = pick('dm', dmMsg, [
    cand('default'),
    cand('all', { notifyLevel: 'all' }),
    cand('mentions-no', { notifyLevel: 'mentions' }),
    cand('mentions-yes', { notifyLevel: 'mentions', mentioned: true }),
    cand('off', { notifyLevel: 'off', mentioned: true }),
  ])
  assert.deepEqual(r, ['default', 'all', 'mentions-yes'])
})

test('스레드 답글: 끔 제외, 이미 멘션된 사람 제외(멘션 푸시가 따로 간다 — 중복 없음)', () => {
  const r = pick('thread', replyMsg, [
    cand('parent-author'),
    cand('muted', { notifyLevel: 'off' }),
    cand('mentioned', { mentioned: true }),
  ])
  assert.deepEqual(r, ['parent-author'])
})

test('채널 새 글: 모든 새 글(all)인 멤버만, 멘션된 사람은 제외', () => {
  const r = pick('channel', channelMsg, [
    cand('default'),
    cand('mentions', { notifyLevel: 'mentions' }),
    cand('all', { notifyLevel: 'all' }),
    cand('all-mentioned', { notifyLevel: 'all', mentioned: true }),
  ])
  assert.deepEqual(r, ['all'])
  // levelAllows 표 직접 확인
  assert.equal(levelAllows('channel', 'all', false), true)
  assert.equal(levelAllows('channel', 'mentions', false), false)
})

test('방해 금지 시간인 사람은 빠진다(서울 기준) — 짝: 같은 사람이 낮에는 받는다', () => {
  const quiet = { enabled: true, start: 22 * 60, end: 8 * 60, weekends: true }
  const c = [cand('sleeper', { mentioned: true, quiet }), cand('awake', { mentioned: true })]
  assert.deepEqual(pick('mention', channelMsg, c, { now: seoul('2026-11-04T23:30:00') }), ['awake'])
  assert.deepEqual(pick('mention', channelMsg, c, { now: seoul('2026-11-05T01:00:00') }), ['awake'])
  assert.deepEqual(pick('mention', channelMsg, c, { now: seoul('2026-11-07T15:00:00') }), ['awake'])
  assert.deepEqual(pick('mention', channelMsg, c, { now: WEEKDAY_NOON }), ['sleeper', 'awake'])
})

test('같은 사람이 후보에 두 번 있어도 한 번만', () => {
  assert.deepEqual(
    pick('mention', channelMsg, [cand('a', { mentioned: true }), cand('a', { mentioned: true })]),
    ['a']
  )
})

// ── endpoint 허용 목록·SSRF ───────────────────────────────────────────────────

test('허용 endpoint: FCM·jmt*.google.com·Mozilla·Apple·WNS', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://jmt17.google.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QK0abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    assert.equal(isAllowedPushEndpoint(ok), true, ok)
  }
})

test('거부 endpoint: http·사용자정보·다른 포트·접미 위장·내부 주소·IP 리터럴', () => {
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://push.apple.com/x', // 접미만 있고 하위 호스트 없음
    'https://evil.com/.push.apple.com',
    'https://push.apple.com.evil.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://localhost/x',
    'https://metadata.internal/x',
    'not a url',
  ]) {
    assert.equal(isAllowedPushEndpoint(bad), false, bad)
  }
  assert.equal(isPublicPushHost('https://10.0.0.1/x'), false)
  assert.equal(isPublicPushHost('https://router.lan/x'), false)
  assert.equal(isPublicPushHost('https://fcm.googleapis.com/x'), true)
})

test('구독 본문 스키마: 허용 endpoint + base64url 키만 통과', () => {
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
  assert.equal(
    subscribeBodySchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })
      .success,
    true
  )
  assert.equal(
    subscribeBodySchema.safeParse({ endpoint: 'https://127.0.0.1/x', keys }).success,
    false
  )
  assert.equal(
    subscribeBodySchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: 'short', auth: 'a'.repeat(22) },
    }).success,
    false
  )
  assert.equal(unsubscribeBodySchema.safeParse({ endpoint: 'nope' }).success, false)
})

// ── 페이로드 ─────────────────────────────────────────────────────────────────

const info = (extra = {}) => ({
  messageId: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  channelId: '22222222-2222-4222-8222-222222222222',
  channelName: '이사회',
  channelSlug: 'board',
  channelKind: 'public',
  isGroup: false,
  groupTitle: null,
  authorName: '김이사',
  body: '**안건** 확인 부탁드립니다',
  sensitive: false,
  ...extra,
})

test('페이로드 모양: 제목·미리보기·/board-room 경로·합치기 tag 네 가지뿐', () => {
  const p = buildPushPayload('mention', info())
  assert.deepEqual(Object.keys(p).sort(), ['body', 'tag', 'title', 'url'])
  assert.equal(p.title, '김이사님이 회원님을 멘션했습니다 · #이사회')
  assert.equal(p.body, '안건 확인 부탁드립니다')
  assert.equal(p.url, '/board-room/c/board#msg-11111111-1111-4111-8111-111111111111')
  assert.equal(p.tag, 'mention:22222222-2222-4222-8222-222222222222')
})

test('페이로드: 민감 표시 메시지는 본문을 싣지 않는다', () => {
  const p = buildPushPayload(
    'dm',
    info({ channelKind: 'dm', sensitive: true, body: '계좌 123-456' })
  )
  assert.equal(p.body.includes('123-456'), false)
  assert.match(p.body, /민감 정보/)
  assert.equal(p.title, '김이사님의 메시지')
  assert.match(p.url, /^\/board-room\/dm\//)
})

test('페이로드: 미리보기는 120자에서 자르고, 답글이면 스레드를 연다, 제목은 100자 이내', () => {
  const long = '가'.repeat(300)
  const p = buildPushPayload(
    'thread',
    info({
      body: long,
      parentId: '33333333-3333-4333-8333-333333333333',
      channelName: 'x'.repeat(200),
    })
  )
  assert.equal(p.body.length, 121) // 120 + …
  assert.match(p.url, /\?thread=33333333-3333-4333-8333-333333333333#msg-/)
  assert.ok(p.title.length <= 100)
  assert.equal(
    pushUrl({
      channelId: 'c',
      channelSlug: null,
      channelKind: 'private',
      messageId: 'm',
      parentId: null,
    }),
    '/board-room/dm/c#msg-m'
  )
})

// ── 발송 몸통(가짜 transport — 네트워크 없음) ────────────────────────────────

const VAPID = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.invalid' }
const sub = (id, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) => ({
  id,
  endpoint,
  p256dh: 'p',
  auth: 'a',
})

test('발송: 404·410은 만료(지울 대상), 그 밖의 실패는 failed, 성공은 okIds', async () => {
  const calls = []
  const transport = async (s, body, vapid) => {
    calls.push({ endpoint: s.endpoint, body: JSON.parse(body), vapid })
    if (s.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 })
    if (s.endpoint.endsWith('/missing')) throw Object.assign(new Error('nf'), { statusCode: 404 })
    if (s.endpoint.endsWith('/boom')) throw Object.assign(new Error('boom'), { statusCode: 500 })
  }
  const payload = { title: 't', body: 'b', url: '/board-room/chat', tag: 'x' }
  const out = await deliverPush(
    [
      sub('ok'),
      sub('gone', 'https://fcm.googleapis.com/fcm/send/gone'),
      sub('missing', 'https://fcm.googleapis.com/fcm/send/missing'),
      sub('boom', 'https://fcm.googleapis.com/fcm/send/boom'),
    ],
    payload,
    VAPID,
    transport
  )
  assert.deepEqual(out.okIds, ['ok'])
  assert.deepEqual(out.goneIds.sort(), ['gone', 'missing'])
  assert.equal(out.failed, 1)
  assert.equal(calls.length, 4)
  assert.deepEqual(calls[0].body, payload)
  assert.equal(calls[0].vapid, VAPID)
})

test('발송 직전 SSRF 재검사: 저장 검증을 우회한 내부 주소 행에는 transport를 부르지 않는다', async () => {
  const called = []
  const out = await deliverPush(
    [
      sub('internal', 'https://169.254.169.254/latest'),
      sub('http', 'http://fcm.googleapis.com/x'),
      sub('local', 'https://localhost/x'),
      sub('ok'),
    ],
    { title: 't', body: 'b', url: '/board-room/chat' },
    VAPID,
    async s => {
      called.push(s.endpoint)
    }
  )
  assert.deepEqual(called, ['https://fcm.googleapis.com/fcm/send/ok'])
  assert.equal(out.blocked, 3)
  assert.equal(isSendableEndpoint('https://169.254.169.254/x'), false)
})

// ── 기기 동기화 표식 ──────────────────────────────────────────────────────────

test('동기화 표식: 같은 사용자·12시간 안이면 건너뛰고, 사용자가 바뀌면 다시 확인한다', () => {
  const now = 1_800_000_000_000
  const mark = formatPushSyncMark('user-a', now - 1000)
  const H12 = 12 * 3600 * 1000
  assert.equal(isPushSyncFresh(mark, 'user-a', H12, now), true)
  assert.equal(isPushSyncFresh(mark, 'user-b', H12, now), false)
  assert.equal(
    isPushSyncFresh(formatPushSyncMark('user-a', now - H12 - 1), 'user-a', H12, now),
    false
  )
  assert.equal(isPushSyncFresh('1799999999000', 'user-a', H12, now), false) // 옛 형식
  assert.equal(isPushSyncFresh(mark, null, H12, now), false)
})

// ── 서비스 워커(public/board-work-sw.js) ─────────────────────────────────────

function loadServiceWorker(origin = 'https://ggac.kr') {
  const listeners = {}
  const opened = []
  const shown = []
  const self = {
    location: new URL(`${origin}/board-work-sw.js`),
    addEventListener: (type, fn) => {
      listeners[type] = fn
    },
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title, opts) => {
        shown.push({ title, opts })
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async url => {
        opened.push(url)
      },
    },
  }
  vm.runInNewContext(readFileSync('public/board-work-sw.js', 'utf8'), { self, URL })
  return { listeners, opened, shown }
}

async function clickWith(url) {
  const sw = loadServiceWorker()
  let waited
  sw.listeners.notificationclick({
    notification: { close: () => undefined, data: { url } },
    waitUntil: p => {
      waited = p
    },
  })
  await waited
  return sw.opened
}

test('서비스 워커: 푸시 전용 — fetch 핸들러가 없다(정적 캐시 없음)', () => {
  const sw = loadServiceWorker()
  assert.equal('fetch' in sw.listeners, false)
  assert.ok(sw.listeners.push)
  assert.ok(sw.listeners.notificationclick)
})

test('서비스 워커: 알림 클릭은 같은 출처 /board-room/ 아래로만 — 그 밖은 업무툴 첫 화면', async () => {
  assert.deepEqual(await clickWith('/board-room/c/board#msg-1'), [
    'https://ggac.kr/board-room/c/board#msg-1',
  ])
  assert.deepEqual(await clickWith('/en/board-room/dm/x'), ['https://ggac.kr/en/board-room/dm/x'])
  for (const bad of [
    'https://evil.example/board-room/c/x',
    '//evil.example/board-room/x',
    '/admin',
    '/',
    'javascript:alert(1)',
    '/board-roomx/c',
    undefined,
  ]) {
    assert.deepEqual(await clickWith(bad), ['https://ggac.kr/board-room/chat'], String(bad))
  }
})

test('서비스 워커: push 이벤트는 알림을 띄우고 data.url도 같은 규칙으로 거른다', async () => {
  const sw = loadServiceWorker()
  let waited
  sw.listeners.push({
    data: { json: () => ({ title: '제목', body: '본문', url: 'https://evil.example/', tag: 't' }) },
    waitUntil: p => {
      waited = p
    },
  })
  await waited
  assert.equal(sw.shown.length, 1)
  assert.equal(sw.shown[0].title, '제목')
  assert.equal(sw.shown[0].opts.data.url, 'https://ggac.kr/board-room/chat')
})
