import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 사무국 대리 환불의 `afterClaim` 갈고리 — 선점 **뒤**, 토스 **앞**.
 *
 * 왜 이 자리인가. 라우트는 선점 전에 정산 지급 여부를 읽는다. 그 읽기와 선점
 * 사이에 다른 관리자가 `mark_paid`를 누르면, 지급된 정산서가 이 환불을 모른 채
 * 굳는다(`isBasisStale`은 지급된 정산서를 다시 보지 않는다). 선점된 후원은
 * 정산 재계산이 **환불로 세므로**, 선점이 들어간 뒤 다시 읽으면 그 뒤로는 창이
 * 없다 — `mark_paid`가 낡은 근거로 스스로 409를 낸다.
 *
 * 트랜잭션으로 묶지 않는 이유는 토스 호출을 트랜잭션 안에 두면 안 되기
 * 때문이다. 그래서 갈고리로 푼다. 여기서 지키는 성질:
 *   - 멈추면 선점을 되돌리고 **토스를 부르지 않는다** (돈이 나가지 않는다)
 *   - 갈고리가 던져도 선점을 되돌리고 다시 던진다 (확인 못 한 채 보내지 않는다)
 *   - 진행하면 평소와 같다
 *   - 재시도 건에도 갈고리는 돈다 (선점은 건너뛰지만 확인은 건너뛰지 않는다)
 *
 * DB·토스 없이 전부 대역이다 — 실행기가 의존성을 주입받기 때문이다.
 */

const OFFICE_URL = new URL('../../src/lib/server/officeRefund.ts', import.meta.url)
const { refundPledgeAsOffice } = await import(OFFICE_URL.href)

function harness() {
  const calls = { claim: 0, revert: 0, toss: 0, finalize: 0 }
  const deps = {
    claimPledgeForCancel: async () => {
      calls.claim += 1
      return { id: 'p1', status: 'canceled', payment_id: 'pay1' }
    },
    revertPledgeCancel: async () => {
      calls.revert += 1
      return true
    },
    cancelPayment: async () => {
      calls.toss += 1
      return { status: 'CANCELED' }
    },
    finalizePledgeRefund: async () => {
      calls.finalize += 1
      return { id: 'p1', status: 'refunded' }
    },
  }
  return { deps, calls }
}

const base = {
  pledgeId: 'p1',
  paymentId: 'pay1',
  paymentKey: 'key1',
  orderId: 'funding_1',
  amount: 30000,
  retry: false,
  secretKey: 'sk_test',
  actorId: 'admin1',
}

test('갈고리가 멈추면 선점을 되돌리고 토스를 부르지 않는다', async () => {
  const { deps, calls } = harness()
  const out = await refundPledgeAsOffice(
    { ...base, afterClaim: async () => ({ proceed: false, message: '그새 지급됐다' }) },
    deps
  )
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'stopped_after_claim')
  assert.equal(out.message, '그새 지급됐다')
  assert.equal(calls.claim, 1, '선점은 한 번 했다')
  assert.equal(calls.revert, 1, '되돌려야 후원이 paid로 남는다')
  assert.equal(calls.toss, 0, '**돈이 나가면 안 된다**')
  assert.equal(calls.finalize, 0)
})

test('갈고리가 던지면 선점을 되돌리고 다시 던진다 — 확인 못 한 채 보내지 않는다', async () => {
  const { deps, calls } = harness()
  await assert.rejects(
    refundPledgeAsOffice(
      {
        ...base,
        afterClaim: async () => {
          throw new Error('정산 조회 실패')
        },
      },
      deps
    ),
    /정산 조회 실패/
  )
  assert.equal(calls.revert, 1)
  assert.equal(calls.toss, 0)
})

test('갈고리가 진행하면 평소와 같다', async () => {
  const { deps, calls } = harness()
  const out = await refundPledgeAsOffice(
    { ...base, afterClaim: async () => ({ proceed: true }) },
    deps
  )
  assert.equal(out.ok, true)
  assert.equal(calls.claim, 1)
  assert.equal(calls.revert, 0)
  assert.equal(calls.toss, 1)
  assert.equal(calls.finalize, 1)
})

test('갈고리가 없으면 예전과 같다', async () => {
  const { deps, calls } = harness()
  const out = await refundPledgeAsOffice(base, deps)
  assert.equal(out.ok, true)
  assert.equal(calls.toss, 1)
})

test('재시도 건은 선점을 건너뛰지만 갈고리는 건너뛰지 않는다', async () => {
  const { deps, calls } = harness()
  let asked = 0
  const out = await refundPledgeAsOffice(
    {
      ...base,
      retry: true,
      afterClaim: async () => {
        asked += 1
        return { proceed: false, message: '그새 지급됐다' }
      },
    },
    deps
  )
  assert.equal(calls.claim, 0, '재시도 건은 앞선 요청이 이미 선점했다')
  assert.equal(asked, 1, '확인은 건너뛰지 않는다')
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'stopped_after_claim')
  assert.equal(calls.toss, 0)
})
