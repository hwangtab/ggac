import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSignupProfileRow } from '../../src/lib/auth/signupProfile.ts'

const INPUT = {
  id: '00000000-0000-4000-8000-000000000abc',
  email: 'new@test.local',
  display_name: '홍길동',
  real_name: '홍길동',
  phone_number: '010-1234-5678',
  birth_date: '1990-03-15',
  monthly_fee: 30000,
  bank_name: '국민',
  account_number: '123-45-678',
  account_holder: '홍길동',
}

test('가입 폼 7개 필드가 전부 행에 실린다', () => {
  const row = buildSignupProfileRow(INPUT)
  for (const f of [
    'real_name',
    'phone_number',
    'birth_date',
    'monthly_fee',
    'bank_name',
    'account_number',
    'account_holder',
  ]) {
    assert.ok(row[f] !== undefined && row[f] !== null, `${f}가 비었다`)
  }
})

test('신규 가입자는 항상 승인 대기 상태다', () => {
  const row = buildSignupProfileRow({ ...INPUT, registration_status: 'approved', is_admin: true })
  // 클라이언트가 보낸 승인 상태·권한을 절대 믿지 않는다.
  assert.equal(row.registration_status, 'pending')
  assert.equal(row.is_active, false)
  assert.equal(row.is_admin, false)
})

test('생년월일은 문자열 그대로 둔다', () => {
  assert.equal(buildSignupProfileRow(INPUT).birth_date, '1990-03-15')
})

test('선택 필드가 없으면 null이지 undefined가 아니다', () => {
  const row = buildSignupProfileRow({ id: INPUT.id, email: INPUT.email, display_name: '아무개' })
  assert.equal(row.real_name, null)
  assert.equal(row.monthly_fee, null)
})

test('표시명이 없으면 던진다', () => {
  assert.throws(() => buildSignupProfileRow({ id: INPUT.id, email: INPUT.email }), /표시명/)
})
