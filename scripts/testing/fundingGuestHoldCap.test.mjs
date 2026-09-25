import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 비회원 선점의 **회선 단위 상한**.
 *
 * 여기서 못박는 것:
 *   - 회원에게는 걸지 않는다(계정으로 이미 세고, 한 회선 뒤의 조합원들이
 *     서로의 상한을 갉아먹으면 안 된다)
 *   - 비회원에게는 **프로젝트별로** 건다
 *   - 세는 창은 선점이 살아 있는 시간이다(이미 풀린 선점을 상한에 얹지 않는다)
 *   - 준비 라우트가 IP 열쇠로 실제로 이 상한을 건다
 */

const { planGuestHoldCap, GUEST_HOLDS_PER_IP_PER_CAMPAIGN } = await import(
  '../../src/lib/funding/guestHoldCap.ts'
)

test('회원에게는 회선 상한을 걸지 않는다', () => {
  assert.equal(planGuestHoldCap({ userId: 'u1', campaignId: 'c1', holdMinutes: 10 }), null)
})

test('비회원에게는 건다 — 창은 선점 시간, 상한은 프로젝트별', () => {
  const cap = planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes: 10 })
  assert.ok(cap)
  assert.equal(cap.windowMs, 10 * 60_000)
  assert.equal(cap.maxRequests, GUEST_HOLDS_PER_IP_PER_CAMPAIGN)
  assert.equal(cap.keySuffix, 'c1')
})

test('프로젝트가 다르면 상한도 따로 센다 — 견주어 보는 사람이 막히지 않는다', () => {
  const a = planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes: 10 })
  const b = planGuestHoldCap({ userId: null, campaignId: 'c2', holdMinutes: 10 })
  assert.notEqual(a.keySuffix, b.keySuffix)
})

test('설정이 바뀌면 창도 따라간다', () => {
  assert.equal(
    planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes: 30 }).windowMs,
    30 * 60_000
  )
})

test('이상한 설정값에도 창이 사라지지 않는다', () => {
  for (const holdMinutes of [0, -5, Number.NaN, undefined]) {
    const cap = planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes })
    assert.equal(cap.windowMs, 10 * 60_000, `${String(holdMinutes)}에서 창이 무너졌다`)
  }
  // 너무 긴 값도 그대로 받지 않는다 — 한 시간 넘게 세면 이미 풀린 선점을 얹는다.
  assert.equal(
    planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes: 6000 }).windowMs,
    60 * 60_000
  )
})

test('빈 문자열 계정은 비회원이다 — 상한이 조용히 사라지지 않는다', () => {
  assert.ok(planGuestHoldCap({ userId: '', campaignId: 'c1', holdMinutes: 10 }))
})

test('막힌 사람에게 할 수 있는 일을 알려 준다', () => {
  const cap = planGuestHoldCap({ userId: null, campaignId: 'c1', holdMinutes: 10 })
  assert.match(cap.message, /10분/)
  assert.match(cap.message, /로그인/)
  assert.match(cap.message, /contact@ggac\.kr/)
})

/**
 * 상한을 "세는 규칙"만 있고 라우트가 걸지 않으면 아무 일도 일어나지 않는다.
 * 열쇠가 IP여야 한다는 것도 여기서 본다 — 요청자가 고르는 값(이메일)으로
 * 되돌아가면 이 상한은 다시 아무것도 세지 못한다.
 */
test('준비 라우트가 IP 열쇠로 이 상한을 건다', () => {
  const src = readFileSync(
    new URL('../../src/app/api/funding/pledges/prepare/route.ts', import.meta.url),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '')
  const code = src.replace(/^\s*\/\/.*$/gm, '')
  assert.match(code, /planGuestHoldCap\(/)
  assert.match(code, /createIPKeyGenerator\('funding-prepare-guest'\)/)
  assert.match(code, /\$\{guestCap\.keySuffix\}/, '프로젝트 조각이 열쇠에서 빠졌다')
  // 재고를 실제로 줄이는 것은 `holdPledge` 하나뿐이다. 상한은 그 앞이어야 한다.
  assert.ok(
    code.indexOf('planGuestHoldCap(') < code.indexOf('await holdPledge('),
    '상한이 선점보다 늦게 선다'
  )
  assert.match(code, /capped\.response\?\.status === 429/)
})
