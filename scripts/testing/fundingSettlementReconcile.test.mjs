import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canceledAmountOf,
  mapWithConcurrency,
  reconcileCampaignWithToss,
  RECONCILE_LOOKUP_CONCURRENCY,
  TOSS_CONSOLE_REFUND_REASON,
} from '../../src/lib/server/settlementReconcile.ts'

function pledge(overrides = {}) {
  return {
    pledge_id: 'p1',
    pledge_code: 'GGAC-0001',
    payment_id: 'pay1',
    payment_key: 'key1',
    order_id: 'order1',
    total_amount: 30000,
    ...overrides,
  }
}

function deps(overrides = {}) {
  return {
    listPaidPledgePayments: async () => [pledge()],
    lookupPayment: async () => ({ status: 'DONE', totalAmount: 30000, balanceAmount: 30000 }),
    finalizePledgeRefund: async () => ({ id: 'p1', status: 'refunded' }),
    logActivity: async () => undefined,
    ...overrides,
  }
}

const input = { campaignId: 'c1', secretKey: 'sk', actorId: 'admin1' }

test('살아 있는 결제는 건드리지 않는다', async () => {
  let finalized = 0
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      finalizePledgeRefund: async () => {
        finalized += 1
        return {}
      },
    })
  )
  assert.equal(result.ok, true)
  assert.equal(result.checked, 1)
  assert.deepEqual(result.reconciled, [])
  assert.equal(finalized, 0)
})

test('토스가 CANCELED라고 하면 원장을 환불로 맞춘다', async () => {
  const calls = []
  const activities = []
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      lookupPayment: async () => ({ status: 'CANCELED', totalAmount: 30000, balanceAmount: 0 }),
      finalizePledgeRefund: async arg => {
        calls.push(arg)
        return { id: 'p1', status: 'refunded' }
      },
      logActivity: async entry => {
        activities.push(entry)
      },
    })
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.reconciled, [
    { pledge_id: 'p1', pledge_code: 'GGAC-0001', amount: 30000 },
  ])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].canceledAmount, 30000)
  assert.equal(calls[0].raw.canceledBy, TOSS_CONSOLE_REFUND_REASON)
  assert.equal(activities.length, 1)
  assert.equal(activities[0].metadata.action, 'settlement_toss_reconcile')
})

test('cancels 배열만 있어도 취소 금액을 읽는다', async () => {
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      lookupPayment: async () => ({
        status: 'CANCELED',
        cancels: [{ cancelAmount: 10000 }, { cancelAmount: 20000 }],
      }),
    })
  )
  assert.equal(result.ok, true)
  assert.equal(result.reconciled[0].amount, 30000)
})

test('조회에 실패하면 아무것도 고치지 않고 거부한다', async () => {
  let finalized = 0
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      lookupPayment: async () => {
        throw new Error('결제 조회 실패: UNKNOWN')
      },
      finalizePledgeRefund: async () => {
        finalized += 1
        return {}
      },
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'lookup')
  assert.equal(result.pledge_code, 'GGAC-0001')
  assert.equal(finalized, 0)
})

test('토스가 모르는 결제도 거부한다 — 임의로 환불 처리하지 않는다', async () => {
  const result = await reconcileCampaignWithToss(input, deps({ lookupPayment: async () => null }))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'lookup')
})

test('부분 취소는 자동으로 맞추지 않는다', async () => {
  let finalized = 0
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      lookupPayment: async () => ({
        status: 'PARTIAL_CANCELED',
        totalAmount: 30000,
        balanceAmount: 20000,
      }),
      finalizePledgeRefund: async () => {
        finalized += 1
        return {}
      },
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'partial')
  assert.equal(finalized, 0)
})

test('원장이 0행이면 거부한다', async () => {
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      lookupPayment: async () => ({ status: 'CANCELED', totalAmount: 30000, balanceAmount: 0 }),
      finalizePledgeRefund: async () => null,
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'ledger')
})

/**
 * 조회는 묶음으로 함께 나가므로 같은 묶음의 뒤 건도 물어본다. 중요한 것은
 * 조회 차례가 아니라 **원장을 한 줄도 건드리지 않는다**는 것, 그리고 사무국에게
 * 말하는 후원번호가 언제나 목록의 앞 건이라는 것이다.
 */
test('한 건이라도 조회에 실패하면 원장을 건드리지 않는다', async () => {
  let finalized = 0
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      listPaidPledgePayments: async () => [
        pledge(),
        pledge({ pledge_id: 'p2', pledge_code: 'GGAC-0002', payment_key: 'key2' }),
      ],
      lookupPayment: async key => {
        if (key === 'key1') throw new Error('끊김')
        return { status: 'CANCELED', totalAmount: 30000, balanceAmount: 0 }
      },
      finalizePledgeRefund: async () => {
        finalized += 1
        return { id: 'p2', status: 'refunded' }
      },
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'lookup')
  assert.equal(result.pledge_code, 'GGAC-0001', '실패를 말하는 후원은 목록 차례를 따른다')
  assert.equal(finalized, 0, '조회 단계의 실패는 원장을 건드리지 않는다')
})

test('뒤 건이 실패해도 앞 건의 환불이 원장에 들어가지 않는다', async () => {
  const finalized = []
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      listPaidPledgePayments: async () => [
        pledge(),
        pledge({ pledge_id: 'p2', pledge_code: 'GGAC-0002', payment_key: 'key2' }),
      ],
      lookupPayment: async key => {
        if (key === 'key2') throw new Error('끊김')
        return { status: 'CANCELED', totalAmount: 30000, balanceAmount: 0 }
      },
      finalizePledgeRefund: async arg => {
        finalized.push(arg.pledgeId)
        return { id: arg.pledgeId, status: 'refunded' }
      },
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.pledge_code, 'GGAC-0002')
  assert.deepEqual(finalized, [], '조회를 다 끝낸 뒤에야 원장을 건드린다')
})

/**
 * 한 줄로 세우면 후원자가 많은 캠페인에서 라우트 수명을 넘긴다. 묶음으로
 * 함께 묻되 한꺼번에 전부 띄우지는 않는다 — 토스 한도.
 */
test('조회는 묶음으로 함께 나간다 — 한 줄로 세우지 않는다', async () => {
  let inFlight = 0
  let peak = 0
  const many = Array.from({ length: 12 }, (_, i) =>
    pledge({ pledge_id: `p${i}`, pledge_code: `GGAC-${i}`, payment_key: `key${i}` })
  )
  const result = await reconcileCampaignWithToss(
    input,
    deps({
      listPaidPledgePayments: async () => many,
      lookupPayment: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))
        inFlight -= 1
        return { status: 'DONE', totalAmount: 30000, balanceAmount: 30000 }
      },
    })
  )
  assert.equal(result.ok, true)
  assert.equal(result.checked, 12)
  assert.ok(peak > 1, '한 줄로 세우고 있다')
  assert.ok(peak <= RECONCILE_LOOKUP_CONCURRENCY, `한 번에 ${peak}건이 나갔다`)
})

test('묶음 도구는 차례를 지키고 묶음 크기를 넘기지 않는다', async () => {
  let inFlight = 0
  let peak = 0
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise(resolve => setTimeout(resolve, 1))
    inFlight -= 1
    return n * 2
  })
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14])
  assert.equal(peak, 3)
  // 0이나 음수를 받아도 멈추지 않는다(한 건씩).
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async n => n), [1, 2])
  assert.deepEqual(await mapWithConcurrency([], 5, async n => n), [])
})

test('canceledAmountOf는 읽을 수 없으면 null이다', () => {
  assert.equal(canceledAmountOf({ totalAmount: 30000, balanceAmount: 30000 }), null)
  assert.equal(canceledAmountOf({}), null)
  assert.equal(canceledAmountOf({ cancels: [] }), null)
  assert.equal(canceledAmountOf({ totalAmount: 30000, balanceAmount: 0 }), 30000)
})

test('토스 호출을 트랜잭션이 감싸지 않는다 — 소스에 db.transaction이 없다', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(
    new URL('../../src/lib/server/settlementReconcile.ts', import.meta.url),
    'utf8'
  )
  // 주석은 걷어내고 본다 — 머리 주석이 이 불변식을 말로 적어 두고 있다.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.equal(code.includes('db.transaction'), false)
})
