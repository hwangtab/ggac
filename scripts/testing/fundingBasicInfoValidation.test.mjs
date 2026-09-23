import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatGoalAmountDisplay,
  parseGoalAmountDisplay,
  toDateInputValue,
} from '../../src/app/[locale]/mypage/funding/[id]/edit/basicInfoValidation.ts'

test('목표 금액 표시는 숫자만 남기고 천 단위 콤마를 붙인다', () => {
  assert.equal(formatGoalAmountDisplay('1000000'), '1,000,000')
  assert.equal(formatGoalAmountDisplay('1,000,000'), '1,000,000')
  assert.equal(formatGoalAmountDisplay('abc'), '')
  assert.equal(formatGoalAmountDisplay(''), '')
})

test('목표 금액 파싱은 1 미만이면 null', () => {
  assert.equal(parseGoalAmountDisplay('1,000,000'), 1000000)
  assert.equal(parseGoalAmountDisplay('0'), null)
  assert.equal(parseGoalAmountDisplay(''), null)
  assert.equal(parseGoalAmountDisplay('-5'), 5) // 부호는 걸러진다(digits만 남음)
})

test('날짜 입력값은 YYYY-MM-DD로 줄이고, 없거나 잘못되면 빈 문자열', () => {
  assert.equal(toDateInputValue('2026-10-19T14:59:59.000Z'), '2026-10-19')
  assert.equal(toDateInputValue(null), '')
  assert.equal(toDateInputValue(undefined), '')
  assert.equal(toDateInputValue('말도 안 되는 값'), '')
})
