import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { sendNoticesPaced } from '../../src/lib/funding/pacedNotices.ts'
import { BULK_MIN_INTERVAL_MS } from '../../src/lib/funding/notifyContent.ts'

/**
 * 만료 크론의 환불 통지는 한 리워드가 통째로 매진된 뒤 수십 건이 된다. 예전에는
 * 그 전부를 `Promise.allSettled`로 한꺼번에 띄웠다 — Resend의 기본 한도가 초당
 * 2통이라, 돈은 돌려받았는데 통지는 대부분 429로 사라졌다.
 */

/** 주석에서 말하는 것과 코드가 하는 것을 가른다. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('간격을 두고 하나씩 보낸다 — 첫 통은 기다리지 않는다', async () => {
  const at = []
  const start = Date.now()
  const notices = Array.from({ length: 4 }, () => async () => {
    at.push(Date.now() - start)
  })
  const result = await sendNoticesPaced(notices, { minIntervalMs: 40 })
  assert.deepEqual(result, { sent: 4, failed: 0, skipped: 0 })
  assert.ok(at[0] < 30, `첫 통이 ${at[0]}ms나 늦었다`)
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i] - at[i - 1] >= 35, `${i}번째 간격이 ${at[i] - at[i - 1]}ms로 너무 짧다`)
  }
})

test('동시에 띄우지 않는다 — 앞 통이 끝나야 다음 통이 시작한다', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const notices = Array.from({ length: 5 }, () => async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(r => setTimeout(r, 5))
    inFlight -= 1
  })
  await sendNoticesPaced(notices, { minIntervalMs: 0 })
  assert.equal(maxInFlight, 1)
})

test('한 통이 실패해도 나머지는 계속 나간다', async () => {
  const sent = []
  const errors = []
  const notices = [
    async () => sent.push('a'),
    async () => {
      throw new Error('boom')
    },
    async () => sent.push('c'),
  ]
  const result = await sendNoticesPaced(notices, {
    minIntervalMs: 0,
    log: { error: (_m, meta) => errors.push(meta) },
  })
  assert.deepEqual(result, { sent: 2, failed: 1, skipped: 0 })
  assert.deepEqual(sent, ['a', 'c'])
  assert.equal(errors.length, 1)
})

test('상한을 넘는 만큼은 보내지 않고 세어서 알린다', async () => {
  let called = 0
  const notices = Array.from({ length: 5 }, () => async () => {
    called += 1
  })
  const logged = []
  const result = await sendNoticesPaced(notices, {
    minIntervalMs: 0,
    limit: 3,
    log: { error: msg => logged.push(msg) },
  })
  assert.deepEqual(result, { sent: 3, failed: 0, skipped: 2 })
  assert.equal(called, 3)
  assert.equal(logged.length, 1)
})

test('기본 간격은 대량 발송과 같은 값을 쓴다 — 한도 판단이 갈라지지 않게', () => {
  assert.equal(BULK_MIN_INTERVAL_MS, 500)
})

/**
 * 속도 제한은 종류별이 아니라 **배포 전체의 것**이다. 만료 크론은 한 번에
 * 사무국 공지·확정 통지·환불 통지·정체 선점 공지를 모을 수 있는데, 종류마다
 * 따로 돌리면 각자 제 간격(초당 2통)을 지키면서 합쳐서는 초당 여섯 통이 되어
 * 정확히 Resend 한도를 넘긴다 — 매진 직후의 스윕이 그 모양이다.
 */
test('만료 크론은 통지 전부를 한 줄에 세워 한 번만 보낸다', () => {
  const src = stripComments(
    readFileSync(
      new URL('../../src/app/api/internal/funding/expire/route.ts', import.meta.url),
      'utf8'
    )
  )
  const paced = src.match(/sendNoticesPaced\s*\(/g) ?? []
  assert.equal(paced.length, 1, `속도 제한기가 ${paced.length}개다 — 합치면 한도를 넘는다`)
  // 네 갈래가 모두 그 한 줄에 들어간다.
  assert.match(src, /officeAlerts,\s*\.\.\.paidNotices,\s*\.\.\.refundNotices/)
  assert.match(src, /notices\.push\(\(\) => notifyStuckHolds\(/)
})
