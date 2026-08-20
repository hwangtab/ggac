import { test } from 'node:test'
import assert from 'node:assert/strict'

const { safeErrorMessage } = await import('../../src/lib/auth/errorMessage.ts')

test('Error에 Error cause가 있으면 cause의 message를 쓴다 (drizzle 보호)', () => {
  const cause = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: member_profiles.email')
  const outer = new Error('겉 메시지는 무시된다', { cause })
  assert.equal(
    safeErrorMessage(outer),
    'SQLITE_CONSTRAINT: UNIQUE constraint failed: member_profiles.email'
  )
})

test('cause가 없는 일반 Error는 그 message를 쓴다', () => {
  const error = new Error('그냥 평범한 에러')
  assert.equal(safeErrorMessage(error), '그냥 평범한 에러')
})

test('DrizzleQueryError 모양(최상위 message에 params 포함)이어도 cause가 있으면 params가 새지 않는다', () => {
  // 실제 DrizzleQueryError#message는 "Failed query: ...\nparams: [...]" 형태로
  // 쿼리 바인딩 파라미터(email·display_name 등 개인정보 포함 가능)를 담는다.
  // cause에는 그런 파라미터가 없는 원인만 있다 — cause를 우선해야 새지 않는다.
  const cause = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: member_profiles.email')
  const drizzleShaped = new Error(
    'Failed query: insert into member_profiles (id, email, display_name) values (?, ?, ?)\n' +
      'params: user-1,hong@example.com,홍길동',
    { cause }
  )
  const message = safeErrorMessage(drizzleShaped)
  assert.equal(message, 'SQLITE_CONSTRAINT: UNIQUE constraint failed: member_profiles.email')
  assert.doesNotMatch(message, /params/)
  assert.doesNotMatch(message, /hong@example\.com/)
  assert.doesNotMatch(message, /홍길동/)
})

test('Supabase 에러 모양(Error를 상속하지 않는 일반 객체)은 message를 code와 함께 쓴다', () => {
  // 실측: 이 저장소의 @supabase/supabase-js 런타임에서 PostgrestError는
  // `instanceof Error`가 false인 일반 객체로 온다. 이전 코드는 이 분기가
  // 없어 String(error)로 떨어져 "[object Object]"만 로그에 남았다.
  const postgrestShapedError = {
    message:
      'insert or update on table "member_profiles" violates foreign key constraint "member_profiles_id_fkey"',
    details: 'Key (id)=(11111111-1111-1111-1111-111111111111) is not present in table "users".',
    hint: null,
    code: '23503',
  }
  const message = safeErrorMessage(postgrestShapedError)
  assert.equal(
    message,
    '23503: insert or update on table "member_profiles" violates foreign key constraint "member_profiles_id_fkey"'
  )
  assert.notEqual(message, '[object Object]')
})

test('details·hint는 절대 결과 문자열에 섞이지 않는다', () => {
  // details는 위반한 행의 실제 값을 그대로 echo하는 경우가 흔하다 — 여기 쓴
  // 값(이메일 하나)이 결과에 절대 나타나면 안 된다. hint도 마찬가지로 뺀다.
  const postgrestShapedError = {
    message: 'duplicate key value violates unique constraint "member_profiles_email_key"',
    details: 'Key (email)=(leaked-secret@example.com) already exists.',
    hint: '스키마 내부 힌트: member_profiles_email_key 인덱스를 확인하세요.',
    code: '23505',
  }
  const message = safeErrorMessage(postgrestShapedError)
  assert.doesNotMatch(message, /leaked-secret@example\.com/)
  assert.doesNotMatch(message, /스키마 내부 힌트/)
  assert.equal(
    message,
    '23505: duplicate key value violates unique constraint "member_profiles_email_key"'
  )
})

test('code가 없는 Supabase 모양 객체는 message만 쓴다', () => {
  const errorWithoutCode = { message: '알 수 없는 원인으로 실패했습니다.' }
  assert.equal(safeErrorMessage(errorWithoutCode), '알 수 없는 원인으로 실패했습니다.')
})

test('code가 빈 문자열이면 접두어를 붙이지 않는다', () => {
  const errorWithEmptyCode = { message: '원인 메시지', code: '' }
  assert.equal(safeErrorMessage(errorWithEmptyCode), '원인 메시지')
})

test('message가 문자열이 아니거나 없는 값은 폴백(String)으로 떨어진다', () => {
  assert.equal(safeErrorMessage('그냥 문자열 에러'), '그냥 문자열 에러')
  assert.equal(safeErrorMessage(404), '404')
  assert.equal(safeErrorMessage(null), 'null')
  assert.equal(safeErrorMessage(undefined), 'undefined')
  assert.equal(safeErrorMessage({ message: 123, code: 'X' }), '[object Object]')
  assert.equal(safeErrorMessage({ notMessage: 'x' }), '[object Object]')
})
