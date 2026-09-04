import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 공연 예매 저장소. 실제 SQLite로 검증한다.
 *
 * 조합비와 달리 티켓은 **수량이 한정돼 있다.** 마지막 한 장을 두 사람이
 * 동시에 살 수 있고, 그걸 막지 못하면 팔지 않은 좌석을 판 것이 된다.
 * 그래서 이 파일의 대부분은 재고에 관한 것이다:
 *
 * - 결제 전 선점(`pending`)도 재고를 차지한다.
 * - 결제하지 않고 사라진 선점은 만료되면 자리를 돌려준다.
 * - 취소된 예매도 자리를 돌려준다.
 * - 정원을 넘겨 팔리지 않는다.
 */

const DB_PATH = 'scripts/testing/.queries-ticketing-test.db'
const MODULE_URL = new URL('../../src/db/queries/ticketing.ts', import.meta.url)

async function loadFresh() {
  return import(`${MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient
let showId
let ticketTypeId

const HOUR = 3600_000

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)

  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO performances (id, slug, title, status, created_at, updated_at)
          VALUES ('perf-1', 'test-show', '테스트 공연', 'open', ?, ?)`,
    args: [now, now],
  })
  await setupClient.execute({
    sql: `INSERT INTO performance_shows (id, performance_id, starts_at, capacity, created_at, updated_at)
          VALUES ('show-1', 'perf-1', ?, 10, ?, ?)`,
    args: [now + 24 * HOUR, now, now],
  })
  await setupClient.execute({
    sql: `INSERT INTO ticket_types (id, performance_id, name, price, max_per_order, members_only, sort_order, created_at, updated_at)
          VALUES ('tt-1', 'perf-1', '일반', 20000, 4, 0, 0, ?, ?)`,
    args: [now, now],
  })
  showId = 'show-1'
  ticketTypeId = 'tt-1'
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

/**
 * 테스트마다 **자체 회차**를 만든다.
 *
 * 회차 하나를 모든 테스트가 공유하면 앞 테스트가 좌석을 소진해 뒤 테스트가
 * 엉뚱한 이유로 실패한다(실제로 그렇게 깨졌다). 재고를 다루는 테스트는
 * 서로의 재고에 영향을 주면 안 된다.
 */
let showSeq = 0
async function makeShow(capacity) {
  const now = Date.now()
  const id = `show-gen-${++showSeq}`
  // 앞 테스트의 동시 쓰기 락이 남아 있을 수 있다. 셋업이 그걸로 죽으면
  // 정작 검증하려던 것과 무관한 이유로 테스트가 빨개진다.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await setupClient.execute({
        sql: `INSERT INTO performance_shows (id, performance_id, starts_at, capacity, created_at, updated_at)
              VALUES (?, 'perf-1', ?, ?, ?, ?)`,
        args: [id, now + 24 * HOUR, capacity, now, now],
      })
      return id
    } catch (error) {
      if (!/SQLITE_BUSY|locked/i.test(String(error))) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error('회차를 만들지 못했다(락 경합).')
}

let orderSeq = 0

/**
 * 결제 주문번호는 예매마다 유일해야 한다(0017의 유니크 인덱스). 테스트가
 * 같은 값을 두 번 쓰면 두 번째 선점이 인덱스에서 죽는데, 그 실패는 재고와
 * 아무 상관이 없어 원인을 찾기 어렵다.
 */
function booking(overrides = {}) {
  return {
    showId,
    ticketTypeId,
    orderId: `order-${++orderSeq}`,
    userId: null,
    bookerName: '홍길동',
    bookerPhone: '01012345678',
    bookerEmail: 'hong@test.local',
    quantity: 2,
    unitPrice: 20000,
    holdMinutes: 10,
    ...overrides,
  }
}

/**
 * 승인 경로는 결제 원장 행이 있어야 돈다. `finalizeTicketPayment`가 주문번호로
 * 결제와 예매를 **함께** 찾아 바꾸기 때문이다.
 */
async function seedPayment(orderId, amount) {
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO payments (id, order_id, kind, order_name, amount, status, canceled_amount, created_at, updated_at)
          VALUES (?, ?, 'ticket', '테스트 주문', ?, 'pending', 0, ?, ?)`,
    args: [`pay-${orderId}`, orderId, amount, now, now],
  })
  return `pay-${orderId}`
}

/** 승인 한 번을 흉내낸다. 좌석 확정까지 끝난 예매를 돌려준다. */
async function confirmVia(mod, held, amount = 40000) {
  await seedPayment(held.order_id, amount)
  return mod.finalizeTicketPayment({
    orderId: held.order_id,
    reservationId: held.id,
    paymentKey: `key-${held.order_id}`,
    method: '카드',
    approvedAt: new Date(),
    raw: { ok: true },
  })
}

// ---------------------------------------------------------------- 선점

test('예매를 선점하면 대기 상태로 저장되고 예매번호가 생긴다', async () => {
  const { holdReservation, getReservationByCode } = await loadFresh()

  const held = await holdReservation(booking())

  assert.ok(held.reservation_code, '현장에서 대조할 예매번호가 있어야 한다')
  assert.equal(held.status, 'pending')
  assert.equal(held.quantity, 2)
  assert.equal(held.total_amount, 40000, '단가 × 매수')

  const found = await getReservationByCode(held.reservation_code)
  assert.equal(found.id, held.id)
})

test('선점에도 만료 시각이 붙는다', async () => {
  // 만료가 없으면 결제창을 열어 두고 사라진 사람이 좌석을 영원히 잠근다.
  const { holdReservation } = await loadFresh()
  const held = await holdReservation(booking())
  assert.ok(held.hold_expires_at, '만료 시각이 없으면 자리가 영영 풀리지 않는다')
  assert.ok(new Date(held.hold_expires_at).getTime() > Date.now())
})

test('예매번호는 매번 다르다', async () => {
  const { holdReservation } = await loadFresh()
  const codes = new Set()
  for (let i = 0; i < 5; i++) {
    const r = await holdReservation(booking({ quantity: 1 }))
    codes.add(r.reservation_code)
  }
  assert.equal(codes.size, 5)
})

// ------------------------------------------------- 예매·결제 결합 (2026-09-04 코드리뷰)

/**
 * 여기 세 테스트가 막는 것은 재고 사고가 아니라 **결제 사고**다.
 *
 * 예전에는 승인 라우트가 주문과 예매를 각각 찾아 놓고 짝을 대조하지 않았다.
 * 싼 주문을 실제로 결제한 뒤 비싼 예매의 id를 실어 보내면 금액 검사(결제 원장
 * 기준)를 통과하고 비싼 좌석이 확정됐고, 금액이 어긋났을 때는 요청이 지목한
 * 예매를 취소해 줬으므로 돈 한 푼 없이 남의 자리를 없앨 수도 있었다.
 *
 * 이제 `reservations.order_id`가 유일한 연결 고리이고, 확정과 취소가 모두 그
 * 값을 WHERE에 넣고 돈다.
 */

test('다른 주문의 예매는 확정되지 않는다', async () => {
  const mod = await loadFresh()
  const show = await makeShow(10)

  const mine = await holdFor(mod, show, 'order-attacker')
  const theirs = await holdFor(mod, show, 'order-victim')

  await seedPayment('order-attacker', 20000)

  // 내 주문번호로 남의 예매를 확정하려 한다.
  const result = await mod.finalizeTicketPayment({
    orderId: 'order-attacker',
    reservationId: theirs.id,
    paymentKey: 'key-attacker',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })

  assert.equal(result, null, '짝이 맞지 않으면 확정되지 않는다')

  const victim = await mod.getReservationById(theirs.id)
  assert.equal(victim.status, 'pending', '남의 예매는 그대로 대기 상태다')

  // 결제 상태 변경도 함께 롤백돼야 한다 — 좌석 없이 결제만 done인 상태가 최악이다.
  const payment = await setupClient.execute({
    sql: `SELECT status FROM payments WHERE order_id = 'order-attacker'`,
  })
  assert.equal(payment.rows[0].status, 'pending', '좌석을 못 잡았으면 결제도 되돌린다')
})

test('다른 주문의 예매는 취소되지 않는다', async () => {
  const mod = await loadFresh()
  const show = await makeShow(10)
  const theirs = await holdFor(mod, show, 'order-victim-2')

  await mod.cancelReservation(theirs.id, { expectedOrderId: 'order-someone-else' })

  const victim = await mod.getReservationById(theirs.id)
  assert.equal(victim.status, 'pending', '주문이 다르면 취소가 아무것도 바꾸지 않는다')
})

test('짝이 맞으면 확정되고 결제도 함께 완료된다', async () => {
  const mod = await loadFresh()
  const show = await makeShow(10)
  const held = await holdFor(mod, show, 'order-happy')

  const confirmed = await confirmVia(mod, held)

  assert.equal(confirmed.status, 'confirmed')
  assert.ok(confirmed.payment_id, '확정된 예매는 결제를 가리킨다')

  const payment = await setupClient.execute({
    sql: `SELECT status, payment_key FROM payments WHERE order_id = 'order-happy'`,
  })
  assert.equal(payment.rows[0].status, 'done')
  assert.equal(payment.rows[0].payment_key, 'key-order-happy')
})

test('같은 주문으로 두 번 확정해도 실패로 답하지 않는다', async () => {
  // 승인 요청이 두 번 오는 것은 드물지 않다(더블클릭, 클라이언트 재시도, 토스
  // 리다이렉트 중복). 두 번째를 실패로 돌려주면 라우트가 멀쩡한 결제를
  // 환불한다 — 관객은 좌석을 잃고 원장에는 승인과 취소가 같이 남는다.
  const mod = await loadFresh()
  const show = await makeShow(10)
  const held = await holdFor(mod, show, 'order-twice')

  const first = await confirmVia(mod, held)
  assert.equal(first.status, 'confirmed')

  const second = await mod.finalizeTicketPayment({
    orderId: 'order-twice',
    reservationId: held.id,
    paymentKey: 'key-order-twice',
    method: '카드',
    approvedAt: new Date(),
    raw: { ok: true },
  })
  assert.ok(second, '두 번째 승인도 성공으로 답해야 한다(환불로 이어지면 안 된다)')
  assert.equal(second.status, 'confirmed')
  assert.equal(second.id, held.id)
})

/** 주문번호를 지정해 한 자리를 선점한다. */
async function holdFor(mod, show, orderId) {
  return mod.holdReservation(booking({ showId: show, quantity: 2, orderId }))
}

// ---------------------------------------------------------------- 재고

test('남은 좌석은 정원에서 선점과 확정을 뺀 값이다', async () => {
  const mod = await loadFresh()
  const { holdReservation, getRemainingSeats, listReservationsByShow } = mod
  const show = await makeShow(10)

  assert.equal(await getRemainingSeats(show), 10)

  const held = await holdReservation(booking({ showId: show, quantity: 3 }))
  assert.equal(await getRemainingSeats(show), 7, '선점도 자리를 차지한다')

  await confirmVia(mod, held)
  assert.equal(await getRemainingSeats(show), 7, '확정돼도 같은 자리다')

  assert.equal((await listReservationsByShow(show)).length, 1)
})

test('만료된 선점은 자리를 돌려준다', async () => {
  const { holdReservation, getRemainingSeats, expireStaleHolds } = await loadFresh()
  const show = await makeShow(10)

  // 이미 지난 만료 시각으로 선점한다(결제창을 열고 사라진 사람).
  await holdReservation(booking({ showId: show, quantity: 2, holdMinutes: -1 }))

  assert.equal(await getRemainingSeats(show), 10, '만료된 선점은 재고에서 빠진다')

  // 청소 작업이 상태까지 정리한다 — 관리자 화면에 "결제 대기"가 쌓이지 않게.
  const expired = await expireStaleHolds()
  assert.ok(expired >= 1)
})

test('취소된 예매는 자리를 돌려준다', async () => {
  const mod = await loadFresh()
  const { holdReservation, cancelReservation, getRemainingSeats } = mod
  const show = await makeShow(10)

  const held = await holdReservation(booking({ showId: show, quantity: 2 }))
  await confirmVia(mod, held)
  assert.equal(await getRemainingSeats(show), 8)

  await cancelReservation(held.id)
  assert.equal(await getRemainingSeats(show), 10, '취소하면 자리가 돌아온다')
})

test('정원을 넘겨 선점할 수 없다', async () => {
  // 초과 판매는 환불로도 되돌릴 수 없는 사고다 — 공연 당일 입장을 거절해야 한다.
  const { holdReservation } = await loadFresh()
  const show = await makeShow(5)

  await assert.rejects(
    () => holdReservation(booking({ showId: show, quantity: 6 })),
    /좌석|남은/,
    '남은 좌석보다 많이 팔면 안 된다'
  )
})

test('남은 좌석을 정확히 채우는 예매는 통과하고, 그 뒤로는 한 장도 못 판다', async () => {
  const { holdReservation, getRemainingSeats } = await loadFresh()
  const show = await makeShow(4)

  const held = await holdReservation(booking({ showId: show, quantity: 4 }))
  assert.equal(held.quantity, 4)
  assert.equal(await getRemainingSeats(show), 0)

  await assert.rejects(() => holdReservation(booking({ showId: show, quantity: 1 })), /좌석|남은/)
})

test('매진된 회차에서 취소가 나오면 다시 팔 수 있다', async () => {
  const mod = await loadFresh()
  const { holdReservation, cancelReservation, getRemainingSeats } = mod
  const show = await makeShow(2)

  const held = await holdReservation(booking({ showId: show, quantity: 2 }))
  await confirmVia(mod, held)
  assert.equal(await getRemainingSeats(show), 0, '매진')

  await cancelReservation(held.id)
  assert.equal(await getRemainingSeats(show), 2)

  const again = await holdReservation(booking({ showId: show, quantity: 1 }))
  assert.equal(again.status, 'pending')
})

// ---------------------------------------------------------------- 공연 상태

/**
 * `getShow`가 회차만 보고 판매 가능 여부를 판정할 수 없게 만들려고, 별도
 * 공연(status 지정 가능)에 회차를 하나 붙여 만든다. `perf-1`은 이미 'open'
 * 고정이라 다른 상태를 검증하려면 공연 자체를 새로 만들어야 한다.
 */
async function makeShowUnderPerformance(status, capacity = 10) {
  const now = Date.now()
  const performanceId = `perf-gen-${++showSeq}`
  const id = `show-gen-${++showSeq}`
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await setupClient.execute({
        sql: `INSERT INTO performances (id, slug, title, status, created_at, updated_at)
              VALUES (?, ?, '테스트 공연(상태)', ?, ?, ?)`,
        args: [performanceId, `test-show-${performanceId}`, status, now, now],
      })
      await setupClient.execute({
        sql: `INSERT INTO performance_shows (id, performance_id, starts_at, capacity, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, performanceId, now + 24 * HOUR, capacity, now, now],
      })
      return id
    } catch (error) {
      if (!/SQLITE_BUSY|locked/i.test(String(error))) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error('회차를 만들지 못했다(락 경합).')
}

test('getShow는 회차가 속한 공연의 상태도 함께 돌려준다', async () => {
  const { getShow } = await loadFresh()

  const show = await getShow(showId)
  assert.equal(show.performance_status, 'open')
  // 기존 키는 그대로 남아 있어야 한다 — 호출부가 이름 그대로 쓰고 있다.
  assert.equal(show.id, showId)
  assert.ok(show.starts_at)
  assert.ok(show.capacity)
})

test('판매 불가 상태(draft/closed/canceled)인 공연의 회차도 조회는 되지만 상태로 구분된다', async () => {
  const { getShow, SELLABLE_PERFORMANCE_STATUSES } = await loadFresh()

  for (const status of ['draft', 'closed', 'canceled']) {
    const show = await makeShowUnderPerformance(status)
    const result = await getShow(show)
    assert.ok(result, `${status} 공연의 회차도 조회는 되어야 한다`)
    assert.equal(result.performance_status, status)
    assert.ok(
      !SELLABLE_PERFORMANCE_STATUSES.includes(status),
      `${status}는 판매 가능 목록에 없어야 한다`
    )
  }

  const openShow = await makeShowUnderPerformance('open')
  const openResult = await getShow(openShow)
  assert.ok(SELLABLE_PERFORMANCE_STATUSES.includes(openResult.performance_status))
})

test('마지막 좌석을 동시에 사려 하면 한 명만 성공한다', async () => {
  // 초과 판매가 나는 전형적인 경로. 재고를 "읽고 나서 쓰기"로 짜면 두 요청이
  // 같은 잔여 수를 읽고 둘 다 통과해, 팔지 않은 좌석을 판 것이 된다.
  // 선점은 트랜잭션 안에서 확인과 INSERT를 함께 해야 한다.
  const { holdReservation, getRemainingSeats } = await loadFresh()
  const show = await makeShow(1)

  const attempts = await Promise.allSettled([
    holdReservation(booking({ showId: show, quantity: 1, bookerName: '가' })),
    holdReservation(booking({ showId: show, quantity: 1, bookerName: '나' })),
    holdReservation(booking({ showId: show, quantity: 1, bookerName: '다' })),
  ])

  const ok = attempts.filter(a => a.status === 'fulfilled')
  assert.equal(ok.length, 1, `한 명만 성공해야 하는데 ${ok.length}명이 성공했다`)
  assert.equal(await getRemainingSeats(show), 0)
})

// 더 큰 부하(5명 × 2매)의 동시 예매는 여기서 검증하지 않는다.
//
// 로컬 **파일** SQLite는 동시 쓰기 트랜잭션에서 락이 오래 물려 테스트가
// 검증 대상과 무관한 이유로 깨진다. 운영은 Turso 서버라 쓰기를 서버가
// 직렬화하므로 성격이 다르다. 초과 판매 방지 자체는 위의 "마지막 좌석을
// 동시에 사려 하면 한 명만 성공한다"가 이미 증명한다.
//
// 락 경합으로 실패한 예매는 `holdReservation`이 짧게 재시도하고, 그래도
// 안 되면 라우트가 "잠시 후 다시 시도" 안내로 바꾼다.
