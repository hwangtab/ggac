import { test } from 'node:test'
import assert from 'node:assert/strict'

const { isBenignShadowUserRetryError } = await import('../../src/lib/auth/shadowUserGuard.ts')

test('GoTrue email_exists(422, 동일 id·email 재시도)는 무해하다', () => {
  // 실측(로컬 GoTrue v2.188.1): 완전 동일한 id·email로 admin.createUser를
  // 재호출하면 SDK가 이 모양의 에러를 준다.
  const error = {
    name: 'AuthApiError',
    message: 'A user with this email address has already been registered',
    status: 422,
    code: 'email_exists',
  }
  assert.equal(isBenignShadowUserRetryError(error), true)
})

test('validation_failed(400, 이메일 형식 오류)는 무해하지 않다', () => {
  // 실측: 이메일 형식이 잘못된 경우 GoTrue는 400 validation_failed를 준다 —
  // "status가 4xx면 무조건 무해"라는 예전(더 넓은) 판정으로 되돌리면 이
  // 케이스도 무해로 잘못 처리된다(같은 400 range). SDK가 실제로 주는 모양
  // (`AuthApiError`, `status`+`code` 둘 다 존재)을 그대로 썼다 — status만
  // 보면 email_exists와 구별이 안 된다는 것을 이 테스트가 고정한다.
  const error = {
    name: 'AuthApiError',
    message: 'Unable to validate email address: invalid format',
    status: 400,
    code: 'validation_failed',
  }
  assert.equal(isBenignShadowUserRetryError(error), false)
})

test('id는 같고 email만 다른 경우의 raw 500(23505)은 무해하지 않다', () => {
  // 실측: 이 GoTrue 버전은 이 경우를 검증 단계에서 안 걸러 raw Postgres
  // 에러(23505, users_pkey 위반)가 그대로 500으로 샌다 — code가
  // 'email_exists'가 아니므로 진짜 실패로 처리돼야 한다.
  const error = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "users_pkey"',
    details: 'Key (id)=(11111111-1111-1111-1111-111111111111) already exists.',
  }
  assert.equal(isBenignShadowUserRetryError(error), false)
})

test('code가 아예 없는 에러는 무해하지 않다', () => {
  const error = { message: '알 수 없는 원인으로 실패했습니다.' }
  assert.equal(isBenignShadowUserRetryError(error), false)
})

test('null은 무해하지 않다', () => {
  assert.equal(isBenignShadowUserRetryError(null), false)
})

test('undefined는 무해하지 않다', () => {
  assert.equal(isBenignShadowUserRetryError(undefined), false)
})
