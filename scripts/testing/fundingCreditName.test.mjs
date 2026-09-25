import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CREDIT_NAME_MAX_LENGTH,
  evaluateCreditName,
  normalizeCreditName,
  splitCreditNames,
} from '../../src/lib/funding/creditName.ts'
import { pledgePaidBackerExtraLines } from '../../src/lib/funding/notifyContent.ts'

test('이름 기재 리워드가 아니면 입력이 있어도 버린다', () => {
  assert.deepEqual(evaluateCreditName({ requiresCreditName: false, raw: '홍길동', quantity: 1 }), {
    ok: true,
    value: null,
  })
})

test('이름 기재 리워드는 이름이 없으면 거절한다', () => {
  for (const raw of [undefined, null, '', '   ', ' , , ', 42]) {
    assert.deepEqual(evaluateCreditName({ requiresCreditName: true, raw, quantity: 1 }), {
      ok: false,
      reason: 'required',
    })
  }
})

test('이름은 수량만큼만 받는다', () => {
  assert.deepEqual(evaluateCreditName({ requiresCreditName: true, raw: '가, 나', quantity: 1 }), {
    ok: false,
    reason: 'too_many',
  })
  assert.deepEqual(
    evaluateCreditName({ requiresCreditName: true, raw: '가,나 ,, ', quantity: 2 }),
    {
      ok: true,
      value: '가, 나',
    }
  )
})

test('제어문자와 겹친 공백을 한 칸으로 줄이고 길이를 자른다', () => {
  assert.equal(normalizeCreditName('  사\n바\t\t하  '), '사 바 하')
  assert.equal(normalizeCreditName('가'.repeat(500)).length, CREDIT_NAME_MAX_LENGTH)
  assert.equal(normalizeCreditName(undefined), '')
})

test('쉼표로 나눈 이름에서 빈 칸을 버린다', () => {
  assert.deepEqual(splitCreditNames(' A , ,B,'), ['A', 'B'])
  assert.deepEqual(splitCreditNames(null), [])
})

test('후원 완료 메일에 기재할 이름을 적고, 없으면 적지 않는다', () => {
  const withName = pledgePaidBackerExtraLines({
    reward_title: 'CD',
    quantity: 1,
    user_id: 'u',
    credit_name: '야호야호단',
  })
  assert.equal(
    withName.some(l => l.startsWith('기재할 이름: 야호야호단')),
    true
  )
  const without = pledgePaidBackerExtraLines({
    reward_title: 'CD',
    quantity: 1,
    user_id: 'u',
    credit_name: null,
  })
  assert.equal(
    without.some(l => l.startsWith('기재할 이름')),
    false
  )
})
