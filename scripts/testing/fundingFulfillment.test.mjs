import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 이행 전이 표와 배송 목록 파일 — 순수 함수만이라 DB도 네트워크도 없다.
 *
 * 여기서 못박는 것은 둘이다. ① 되돌릴 수 있는 이동이 **사무국의
 * `preparing → none` 하나뿐**인가(다른 역행이 열리면 이미 부친 물건에 대해
 * 자동 환불이 다시 열린다). ② 엑셀에서 열릴 파일이 **한글·수식·앞의 0**을
 * 제대로 다루는가.
 */

const f = await import('../../src/lib/funding/fulfillment.ts')
const x = await import('../../src/lib/funding/shippingExport.ts')

// ---------------------------------------------------------------- 전이 표

test('전진은 건너뛰어도 되고, 역행은 사무국의 preparing → none 하나뿐이다', () => {
  // 전진(건너뛰기 포함)
  for (const [from, to] of [
    ['none', 'preparing'],
    ['none', 'shipped'],
    ['none', 'delivered'],
    ['preparing', 'shipped'],
    ['preparing', 'delivered'],
    ['shipped', 'delivered'],
  ]) {
    assert.equal(f.canTransitionFulfillment(from, to, false), true, `${from}→${to}`)
    assert.equal(f.canTransitionFulfillment(from, to, true), true, `${from}→${to} (관리자)`)
  }

  // 역행은 개설자에게 전부 막힌다.
  for (const [from, to] of [
    ['preparing', 'none'],
    ['shipped', 'none'],
    ['shipped', 'preparing'],
    ['delivered', 'none'],
    ['delivered', 'preparing'],
    ['delivered', 'shipped'],
  ]) {
    assert.equal(f.canTransitionFulfillment(from, to, false), false, `${from}→${to}`)
  }

  // 관리자에게도 열리는 것은 preparing → none 하나뿐이다. 이미 나간 물건을
  // 되돌리는 길은 누구에게도 없다.
  assert.equal(f.canTransitionFulfillment('preparing', 'none', true), true)
  assert.equal(f.canTransitionFulfillment('shipped', 'none', true), false)
  assert.equal(f.canTransitionFulfillment('delivered', 'none', true), false)
  assert.equal(f.canTransitionFulfillment('shipped', 'preparing', true), false)

  // 제자리는 이동이 아니다 — 조건부 쓰기가 0행으로 답해야 하는 자리다.
  for (const s of f.FULFILLMENT_ORDER) {
    assert.equal(f.canTransitionFulfillment(s, s, true), false, `${s}→${s}`)
  }
})

test('되돌리기의 출발 상태 목록은 개설자에게 비어 있다', () => {
  assert.deepEqual(f.allowedSourcesFor('none', false), [])
  assert.deepEqual(f.allowedSourcesFor('none', true), ['preparing'])
  assert.deepEqual(f.allowedSourcesFor('shipped', false), ['none', 'preparing'])
  assert.deepEqual(f.allowedSourcesFor('delivered', false), ['none', 'preparing', 'shipped'])
})

test('알림은 발송 경계를 넘을 때 한 번만 — 준비 중과 이미 보낸 건은 조용하다', () => {
  assert.equal(f.crossesSentBoundary('none', 'shipped'), true)
  assert.equal(f.crossesSentBoundary('preparing', 'shipped'), true)
  // 건너뛴 전진도 경계를 넘는다 — 그 사람에게도 물건은 떠났다.
  assert.equal(f.crossesSentBoundary('none', 'delivered'), true)
  // 내부 단계는 알리지 않는다.
  assert.equal(f.crossesSentBoundary('none', 'preparing'), false)
  // 이미 보냈다고 알린 건을 전달 완료로 마저 옮길 때 다시 알리지 않는다.
  assert.equal(f.crossesSentBoundary('shipped', 'delivered'), false)
})

test('이행을 움직일 수 있는 캠페인 상태에는 active가 들어 있다', () => {
  // 약관 제4조가 "진행 중이고 준비가 시작되기 전"을 자동 취소의 조건으로
  // 삼는다. active를 빼면 취소 라우트의 이행 조건이 여전히 영영 걸리지
  // 않는다(두 조건의 곱이기 때문이다).
  assert.equal(f.isFulfillableCampaignStatus('active'), true)
  assert.equal(f.isFulfillableCampaignStatus('closed'), true)
  assert.equal(f.isFulfillableCampaignStatus('settled'), true)
  assert.equal(f.isFulfillableCampaignStatus('draft'), false)
  assert.equal(f.isFulfillableCampaignStatus('submitted'), false)
})

// ---------------------------------------------------------------- 배송 목록

test('파일은 BOM으로 시작하고 CRLF로 줄을 나눈다 — 윈도우 엑셀이 한글을 읽는 조건', () => {
  const csv = x.buildShippingCsv([])
  assert.equal(csv[0], '﻿')
  assert.ok(csv.includes('\r\n'))
  assert.ok(csv.includes('"우편번호"'))
})

test('수식으로 시작하는 값은 수식이 되지 않는다', () => {
  // 후원자가 입력창에 적은 값이 개설자의 엑셀에서 실행되면 안 된다.
  for (const evil of ['=HYPERLINK("http://evil/","클릭")', '+1+1', '-1+1', '@SUM(A1)', '\tcmd']) {
    const cell = x.csvCell(evil)
    assert.ok(cell.startsWith(`"'`), `${evil} → ${cell}`)
  }
  // 평범한 값은 건드리지 않는다.
  assert.equal(x.csvCell('서울시 강남구'), '"서울시 강남구"')
})

test('따옴표와 줄바꿈이 든 값이 칸을 깨뜨리지 않는다', () => {
  assert.equal(x.csvCell('그는 "여기"라고 적었다'), '"그는 ""여기""라고 적었다"')
  const csv = x.buildShippingCsv([{ shipping_memo: '첫 줄\n둘째 줄' }])
  // 줄바꿈은 따옴표 안에 그대로 남는다(RFC 4180). 줄 수로 세면 안 되는 이유다.
  assert.ok(csv.includes('"첫 줄\n둘째 줄"'))
})

test('우편번호와 전화번호는 앞의 0을 잃지 않는다', () => {
  // 그냥 적으면 엑셀이 06236을 6236으로, 01012345678을 1012345678로 만든다.
  assert.equal(x.csvDigits('06236'), '"=""06236"""')
  assert.equal(x.csvDigits('010-1234-5678'), '"=""010-1234-5678"""')
  // 숫자와 하이픈만 남기므로 이 칸으로는 수식이 들어갈 수 없다.
  assert.equal(x.csvDigits('=cmd|calc'), '""')
  assert.equal(x.csvDigits(null), '""')
})

test('표 한 줄은 머리글과 같은 칸 수이고 이행 상태는 한국어로 적힌다', () => {
  const csv = x.buildShippingCsv([
    {
      pledge_code: 'FND-20260923-ABCDEFGH',
      backer_name: '익명',
      shipping_name: '김수취',
      shipping_phone: '01012345678',
      shipping_postcode: '06236',
      shipping_address1: '서울시 강남구 테헤란로 1',
      shipping_address2: '3층',
      shipping_memo: '부재 시 경비실',
      reward_title: 'CD 한 장',
      quantity: 2,
      fulfillment_status: 'shipped',
    },
  ])
  const [header, row] = csv.replace(/^﻿/, '').trimEnd().split('\r\n')
  assert.equal(header.split(',').length, x.SHIPPING_EXPORT_HEADERS.length)
  assert.equal(row.split(',').length, x.SHIPPING_EXPORT_HEADERS.length)
  assert.ok(row.includes('"발송 완료"'))
  assert.ok(row.includes('"익명"'))
})

test('내려받기 파일명은 한글을 RFC 5987로 주고 ASCII 이름을 함께 남긴다', () => {
  const d = x.shippingExportDisposition('첫 "정규" 앨범', new Date('2026-09-23T00:00:00Z'))
  assert.ok(d.startsWith('attachment; '))
  assert.ok(d.includes('filename="funding-shipping-excel-2026-09-23.csv"'))
  assert.ok(d.includes("filename*=UTF-8''"))
  // 헤더를 깨뜨릴 글자는 이름에서 사라진다.
  assert.ok(!d.includes('"첫'))
  // 두 판본이 같은 이름으로 내려오면 폴더에서 구분되지 않는다.
  const c = x.shippingExportDisposition('앨범', new Date('2026-09-23T00:00:00Z'), 'courier')
  assert.ok(c.includes('filename="funding-shipping-courier-2026-09-23.csv"'))
  assert.notEqual(c, d)
})

// ---------------------------------------------------------------- 두 판본

test('택배사 판본은 우편번호·전화번호를 값 그대로 준다', () => {
  // 엑셀 판본의 ="06236"을 택배사 양식에 그대로 올리면 전화번호 칸에 그
  // 글자가 들어가 배달되지 않는 행이 된다 — 하필 이 처리가 지키려던 바로
  // 그 두 칸에서.
  assert.equal(x.csvDigits('06236', 'excel'), String.raw`"=""06236"""`)
  assert.equal(x.csvDigits('06236', 'courier'), '"06236"')
  assert.equal(x.csvDigits('010-1234-5678', 'courier'), '"010-1234-5678"')
  // 어느 판본이든 숫자·하이픈만 남는다 — 이 칸으로 수식은 못 들어간다.
  assert.equal(x.csvDigits('=cmd|calc', 'courier'), '""')
})

test('택배사 판본도 BOM과 수식 차단은 그대로다', () => {
  const csv = x.buildShippingCsv(
    [{ shipping_postcode: '06236', shipping_memo: '=HYPERLINK("http://evil/","x")' }],
    'courier'
  )
  // 한글은 어느 쪽에서든 깨지면 안 된다.
  assert.equal(csv[0], '\uFEFF')
  // 남이 적은 글자가 수식이 되는 것도 어느 쪽에서든 안 된다.
  assert.ok(csv.includes(String.raw`"'=HYPERLINK`))
  // 값 그대로인 것은 앞의 0을 지켜야 하는 두 칸뿐이다.
  assert.ok(csv.includes('"06236"'))
  assert.ok(!csv.includes(String.raw`=""06236""`))
})

test('모르는 판본 이름은 엑셀로 떨어진다', () => {
  assert.equal(x.parseShippingExportFormat('courier'), 'courier')
  assert.equal(x.parseShippingExportFormat('excel'), 'excel')
  assert.equal(x.parseShippingExportFormat(null), 'excel')
  assert.equal(x.parseShippingExportFormat('xlsx'), 'excel')
})

test('직접 취소가 열리는 캠페인 상태는 active 하나뿐이다', () => {
  // 이행 빗장(`reopensSelfCancel`)이 풀려도 취소 라우트는 캠페인이 active일
  // 때만 연다. 둘을 같은 것으로 보면 마감된 캠페인의 후원자에게 "직접
  // 취소하실 수 있습니다"라고 알리게 된다.
  assert.equal(f.campaignAllowsSelfCancel('active'), true)
  for (const status of ['draft', 'submitted', 'closed', 'settled', '', null, undefined]) {
    assert.equal(f.campaignAllowsSelfCancel(status), false, String(status))
  }
})
