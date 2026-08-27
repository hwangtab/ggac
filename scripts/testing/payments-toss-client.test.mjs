import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  confirmPayment,
  cancelPayment,
  lookupPayment,
  issueBillingKey,
  chargeBilling,
  deleteBillingKey,
  TossApiError,
  TossLookupError,
} from '../../src/lib/payments/toss/client.ts'

/**
 * 토스 API 호출 계층. `fetch`를 주입해 네트워크 없이 검증한다
 * (`src/middleware/profile.ts`가 조회 함수를 주입받는 것과 같은 패턴).
 *
 * 여기서 지키는 계약 중 가장 중요한 것은 **"조회 실패"와 "결제 없음"을 절대
 * 같게 다루지 않는다**는 것이다. 이 둘을 뭉개면 통신 장애가 났을 때 멀쩡히
 * 결제된 건을 "결제 안 됨"으로 판단해 환불 없이 취소해버린다.
 */

const SECRET = 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 호출 기록을 남기는 가짜 fetch. */
function recordingFetch(responder) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return responder(String(url), init)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

// ---------------------------------------------------------------- 승인

test('승인 요청에 Basic 인증과 멱등키가 붙는다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'DONE', paymentKey: 'pk_1' }))

  await confirmPayment(
    { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 },
    { secretKey: SECRET, fetchImpl }
  )

  const [call] = fetchImpl.calls
  assert.equal(call.url, 'https://api.tosspayments.com/v1/payments/confirm')
  assert.equal(call.init.method, 'POST')
  assert.equal(
    call.init.headers.Authorization,
    'Basic dGVzdF9nc2tfZG9jc19PYVB6OEw1S2RtUVhrelJ6M3k0N0JNdzY6'
  )
  assert.ok(call.init.headers['Idempotency-Key'], '멱등키가 없으면 재시도가 이중 결제가 된다')
})

test('승인 본문은 우리가 정한 금액을 정수로 보낸다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'DONE' }))

  await confirmPayment(
    { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 },
    { secretKey: SECRET, fetchImpl }
  )

  const body = JSON.parse(fetchImpl.calls[0].init.body)
  assert.deepEqual(body, { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 })
})

test('같은 주문을 재시도하면 멱등키가 같다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'DONE' }))
  const input = { paymentKey: 'pk_1', orderId: 'dues_same', amount: 30000 }

  await confirmPayment(input, { secretKey: SECRET, fetchImpl })
  await confirmPayment(input, { secretKey: SECRET, fetchImpl })

  assert.equal(
    fetchImpl.calls[0].init.headers['Idempotency-Key'],
    fetchImpl.calls[1].init.headers['Idempotency-Key']
  )
})

test('승인 성공 응답을 그대로 돌려준다', async () => {
  const fetchImpl = recordingFetch(() =>
    jsonResponse(200, { status: 'DONE', paymentKey: 'pk_1', method: '카드', totalAmount: 30000 })
  )

  const result = await confirmPayment(
    { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 },
    { secretKey: SECRET, fetchImpl }
  )

  assert.equal(result.status, 'DONE')
  assert.equal(result.method, '카드')
})

test('토스가 거절하면 코드와 메시지를 담은 오류를 던진다', async () => {
  const fetchImpl = recordingFetch(() =>
    jsonResponse(400, {
      code: 'REJECT_CARD_PAYMENT',
      message: '한도초과 혹은 잔액부족으로 결제에 실패했습니다.',
    })
  )

  await assert.rejects(
    () =>
      confirmPayment(
        { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 },
        { secretKey: SECRET, fetchImpl }
      ),
    error => {
      assert.ok(error instanceof TossApiError)
      assert.equal(error.code, 'REJECT_CARD_PAYMENT')
      assert.match(error.message, /한도초과/)
      assert.equal(error.status, 400)
      return true
    }
  )
})

test('승인 중 네트워크가 끊기면 거절이 아니라 판단 불가로 다룬다', async () => {
  // 승인 요청이 실제로 토스에 닿았는지 알 수 없는 상태다. 여기서 "실패"로
  // 단정하면, 실제로는 승인된 결제를 미결제로 기록하게 된다.
  const fetchImpl = recordingFetch(() => {
    throw new TypeError('fetch failed')
  })

  await assert.rejects(
    () =>
      confirmPayment(
        { paymentKey: 'pk_1', orderId: 'dues_abc123', amount: 30000 },
        { secretKey: SECRET, fetchImpl }
      ),
    TossLookupError
  )
})

// ---------------------------------------------------------------- 조회

test('조회에 성공하면 결제 객체를 돌려준다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'DONE', paymentKey: 'pk_9' }))

  const result = await lookupPayment('pk_9', { secretKey: SECRET, fetchImpl })

  assert.equal(result.status, 'DONE')
  assert.equal(fetchImpl.calls[0].url, 'https://api.tosspayments.com/v1/payments/pk_9')
  assert.equal(fetchImpl.calls[0].init.method, 'GET')
})

test('결제가 없다는 답이 오면 null이다', async () => {
  // 이건 "판단이 됐고, 없다"는 뜻이다. 대기 만료 처리로 넘어가도 된다.
  const fetchImpl = recordingFetch(() =>
    jsonResponse(404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제 입니다.' })
  )

  assert.equal(await lookupPayment('pk_none', { secretKey: SECRET, fetchImpl }), null)
})

test('조회가 서버 오류로 실패하면 null이 아니라 판단 불가로 던진다', async () => {
  // 가장 중요한 계약. 500을 null로 뭉개면 "결제 없음"과 구분되지 않아,
  // 대사 크론이 멀쩡한 결제를 만료 처리한다.
  const fetchImpl = recordingFetch(() => jsonResponse(500, { code: 'INTERNAL', message: '오류' }))

  await assert.rejects(
    () => lookupPayment('pk_x', { secretKey: SECRET, fetchImpl }),
    TossLookupError
  )
})

test('조회 중 네트워크가 끊겨도 판단 불가로 던진다', async () => {
  const fetchImpl = recordingFetch(() => {
    throw new TypeError('fetch failed')
  })

  await assert.rejects(
    () => lookupPayment('pk_x', { secretKey: SECRET, fetchImpl }),
    TossLookupError
  )
})

test('인증이 잘못돼도 판단 불가로 던진다', async () => {
  // 401은 우리 설정 문제지 "결제가 없다"는 뜻이 아니다.
  const fetchImpl = recordingFetch(() =>
    jsonResponse(401, { code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 시크릿 키 입니다.' })
  )

  await assert.rejects(
    () => lookupPayment('pk_x', { secretKey: SECRET, fetchImpl }),
    TossLookupError
  )
})

// ---------------------------------------------------------------- 취소

test('취소 요청은 결제키 경로로 가고 사유를 싣는다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'CANCELED', cancels: [] }))

  await cancelPayment(
    'pk_c',
    { cancelReason: '조합원 요청', orderId: 'dues_c' },
    { secretKey: SECRET, fetchImpl }
  )

  const call = fetchImpl.calls[0]
  assert.equal(call.url, 'https://api.tosspayments.com/v1/payments/pk_c/cancel')
  assert.equal(JSON.parse(call.init.body).cancelReason, '조합원 요청')
  assert.ok(call.init.headers['Idempotency-Key'])
})

test('부분 취소는 금액을 싣고, 전액 취소는 싣지 않는다', async () => {
  // 토스는 cancelAmount가 없으면 전액 취소로 처리한다. 0을 보내면 안 된다.
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'CANCELED' }))

  await cancelPayment(
    'pk_c',
    { cancelReason: '부분 환불', orderId: 'dues_c', cancelAmount: 10000 },
    { secretKey: SECRET, fetchImpl }
  )
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).cancelAmount, 10000)

  await cancelPayment(
    'pk_c',
    { cancelReason: '전액 환불', orderId: 'dues_c' },
    { secretKey: SECRET, fetchImpl }
  )
  assert.equal('cancelAmount' in JSON.parse(fetchImpl.calls[1].init.body), false)
})

test('이미 취소된 결제라는 응답은 성공으로 다룬다', async () => {
  // 재시도나 웹훅 중복으로 같은 취소가 두 번 나갈 수 있다. 여기서 던지면
  // 환불이 끝났는데도 화면에 실패가 뜬다.
  const fetchImpl = recordingFetch(() =>
    jsonResponse(400, { code: 'ALREADY_CANCELED_PAYMENT', message: '이미 취소된 결제 입니다.' })
  )

  const result = await cancelPayment(
    'pk_c',
    { cancelReason: '중복 취소', orderId: 'dues_c' },
    { secretKey: SECRET, fetchImpl }
  )

  assert.equal(result.alreadyCanceled, true)
})

// ---------------------------------------------------------------- 자동결제(빌링)

test('빌링키 발급은 인증키와 구매자 식별값을 보낸다', async () => {
  const fetchImpl = recordingFetch(() =>
    jsonResponse(200, { billingKey: 'bk_1', card: { issuerCode: '61', number: '4330****' } })
  )

  const result = await issueBillingKey(
    { authKey: 'auth_abc', customerKey: 'm_hash1' },
    { secretKey: SECRET, fetchImpl }
  )

  const call = fetchImpl.calls[0]
  assert.equal(call.url, 'https://api.tosspayments.com/v1/billing/authorizations/issue')
  assert.deepEqual(JSON.parse(call.init.body), { authKey: 'auth_abc', customerKey: 'm_hash1' })
  assert.equal(result.billingKey, 'bk_1')
})

test('빌링키 발급이 거절되면 코드를 담아 던진다', async () => {
  const fetchImpl = recordingFetch(() =>
    jsonResponse(404, {
      code: 'NOT_FOUND_BILLING',
      message: '존재하지 않는 빌링 결제 인증 정보 입니다.',
    })
  )

  await assert.rejects(
    () =>
      issueBillingKey({ authKey: 'bad', customerKey: 'm_hash1' }, { secretKey: SECRET, fetchImpl }),
    error => {
      assert.ok(error instanceof TossApiError)
      assert.equal(error.code, 'NOT_FOUND_BILLING')
      return true
    }
  )
})

test('자동결제 승인은 빌링키 경로로 가고 필수 항목을 싣는다', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { status: 'DONE', paymentKey: 'pk_b' }))

  await chargeBilling(
    'bk_1',
    {
      customerKey: 'm_hash1',
      amount: 30000,
      orderId: 'dues_b1',
      orderName: '2026년 9월 조합비',
      customerEmail: 'a@b.kr',
      customerName: '홍길동',
    },
    { secretKey: SECRET, fetchImpl }
  )

  const call = fetchImpl.calls[0]
  assert.equal(call.url, 'https://api.tosspayments.com/v1/billing/bk_1')
  const body = JSON.parse(call.init.body)
  assert.equal(body.customerKey, 'm_hash1')
  assert.equal(body.amount, 30000)
  assert.equal(body.orderId, 'dues_b1')
  assert.equal(body.orderName, '2026년 9월 조합비')
  assert.ok(call.init.headers['Idempotency-Key'], '재시도가 이중 청구가 되면 안 된다')
})

test('자동결제 승인에 60초 이상 기다린다', async () => {
  // 토스 문서: "자동결제 승인은 최대 60초가 소요됩니다. 타임아웃 값을 최소
  // 60초로 설정하세요." 더 짧으면 승인됐는지 모르는 상태로 끊긴다.
  let seenSignal = null
  const fetchImpl = recordingFetch((_url, init) => {
    seenSignal = init.signal
    return jsonResponse(200, { status: 'DONE' })
  })

  await chargeBilling(
    'bk_1',
    { customerKey: 'm_h', amount: 30000, orderId: 'dues_t', orderName: '회비' },
    { secretKey: SECRET, fetchImpl }
  )

  assert.ok(seenSignal, '타임아웃 시그널이 붙어야 한다')
})

test('빌링키와 구매자 식별값이 어긋나면 명확한 거절로 던진다', async () => {
  const fetchImpl = recordingFetch(() =>
    jsonResponse(400, {
      code: 'NOT_MATCHES_CUSTOMER_KEY',
      message: 'customerKey와 매핑되지 않은 billingKey 입니다.',
    })
  )

  await assert.rejects(
    () =>
      chargeBilling(
        'bk_1',
        { customerKey: 'wrong', amount: 30000, orderId: 'dues_x', orderName: '회비' },
        { secretKey: SECRET, fetchImpl }
      ),
    error => {
      assert.ok(error instanceof TossApiError)
      assert.equal(error.code, 'NOT_MATCHES_CUSTOMER_KEY')
      return true
    }
  )
})

test('자동결제 중 네트워크가 끊기면 판단 불가로 던진다', async () => {
  // 청구가 나갔는지 모르는 상태다. 실패로 단정해 재시도하면 이중 청구가 된다.
  const fetchImpl = recordingFetch(() => {
    throw new TypeError('fetch failed')
  })

  await assert.rejects(
    () =>
      chargeBilling(
        'bk_1',
        { customerKey: 'm_h', amount: 30000, orderId: 'dues_n', orderName: '회비' },
        { secretKey: SECRET, fetchImpl }
      ),
    TossLookupError
  )
})

test('빌링키 삭제는 DELETE로 보내고 응답 본문에 기대지 않는다', async () => {
  // 문서(레퍼런스)는 "빈 body에 200", 가이드는 "{billingKey}"라고 적어 서로
  // 다르다. 본문을 파싱해 판정하면 한쪽 문서 기준에서만 동작한다.
  const fetchImpl = recordingFetch(() => new Response(null, { status: 200 }))

  const ok = await deleteBillingKey('bk_1', { secretKey: SECRET, fetchImpl })

  assert.equal(fetchImpl.calls[0].url, 'https://api.tosspayments.com/v1/billing/bk_1')
  assert.equal(fetchImpl.calls[0].init.method, 'DELETE')
  assert.equal(ok, true)
})

test('이미 삭제된 빌링키는 성공으로 다룬다', async () => {
  // 해지 재시도에서 여기서 던지면 회원 화면에 "해지 실패"가 뜬다.
  const fetchImpl = recordingFetch(() =>
    jsonResponse(404, { code: 'NOT_FOUND_BILLING_KEY', message: '존재하지 않는 빌링키 입니다.' })
  )

  assert.equal(await deleteBillingKey('bk_gone', { secretKey: SECRET, fetchImpl }), true)
})
