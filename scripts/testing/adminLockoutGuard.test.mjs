import { test } from 'node:test'
import assert from 'node:assert/strict'

const { adminLockoutVerdict, isAdminLockoutAction } = await import(
  '../../src/lib/members/adminLockoutGuard.ts'
)

const base = {
  action: 'deactivate',
  actorId: 'admin-1',
  targetId: 'member-9',
  targetIsActiveAdmin: false,
  remainingActiveAdminCount: 0,
}

test('자격을 되돌려 주는 액션은 이 판정을 타지 않는다', () => {
  for (const action of ['approve', 'activate', 'unsuspend', 'withdraw']) {
    assert.equal(isAdminLockoutAction(action), false, action)
  }
  for (const action of ['reject', 'deactivate', 'suspend']) {
    assert.equal(isAdminLockoutAction(action), true, action)
  }
  // 프로토타입 체인을 타고 참이 되지 않는다.
  assert.equal(isAdminLockoutAction('toString'), false)
  assert.equal(isAdminLockoutAction('constructor'), false)
})

test('관리자가 아닌 회원은 몇 명이 남든 내릴 수 있다', () => {
  assert.equal(adminLockoutVerdict(base).blocked, false)
  assert.equal(
    adminLockoutVerdict({ ...base, remainingActiveAdminCount: 0, targetIsActiveAdmin: false })
      .blocked,
    false,
    '대상이 관리자가 아니면 남는 관리자 수를 보지 않는다'
  )
})

test('자기 자신은 내릴 수 없다 — 관리자가 여럿 남아 있어도', () => {
  const v = adminLockoutVerdict({
    ...base,
    targetId: base.actorId,
    targetIsActiveAdmin: true,
    remainingActiveAdminCount: 5,
  })
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'self')
  assert.equal(v.message, '자기 자신은 비활성화할 수 없습니다.')
})

test('자기 자신 판정은 대상이 관리자가 아니어도 걸린다', () => {
  // 관리자 자격을 스스로 뗀 뒤 자기 계정을 정지하는 경로도 같은 문을 지난다.
  const v = adminLockoutVerdict({
    ...base,
    action: 'suspend',
    targetId: base.actorId,
    targetIsActiveAdmin: false,
  })
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'self')
  assert.equal(v.message, '자기 자신은 정지할 수 없습니다.')
})

test('마지막 관리자는 내릴 수 없다', () => {
  const v = adminLockoutVerdict({
    ...base,
    targetIsActiveAdmin: true,
    remainingActiveAdminCount: 0,
  })
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'last_admin')
  assert.match(v.message, /마지막 관리자는 비활성화할 수 없습니다/)
  assert.match(v.message, /다른 관리자를 먼저 지정/, '무엇을 해야 하는지 말해야 한다')
})

test('관리자가 한 명이라도 남으면 다른 관리자를 내릴 수 있다', () => {
  assert.equal(
    adminLockoutVerdict({ ...base, targetIsActiveAdmin: true, remainingActiveAdminCount: 1 })
      .blocked,
    false
  )
})

test('액션마다 동사가 문장에 맞게 바뀐다', () => {
  const cases = [
    ['deactivate', '비활성화'],
    ['suspend', '정지'],
    ['reject', '거부'],
  ]
  for (const [action, label] of cases) {
    const self = adminLockoutVerdict({ ...base, action, targetId: base.actorId })
    assert.equal(self.message, `자기 자신은 ${label}할 수 없습니다.`)

    const last = adminLockoutVerdict({
      ...base,
      action,
      targetIsActiveAdmin: true,
      remainingActiveAdminCount: 0,
    })
    assert.match(last.message, new RegExp(`마지막 관리자는 ${label}할 수 없습니다`))
  }
})

test('둘 다 걸리면 자기 자신을 먼저 말한다', () => {
  const v = adminLockoutVerdict({
    ...base,
    targetId: base.actorId,
    targetIsActiveAdmin: true,
    remainingActiveAdminCount: 0,
  })
  assert.equal(v.reason, 'self')
})

test('남는 관리자 수가 숫자가 아니면 0으로 본다 — 열지 않는다', () => {
  for (const bad of [undefined, null, NaN, 'many']) {
    const v = adminLockoutVerdict({
      ...base,
      targetIsActiveAdmin: true,
      remainingActiveAdminCount: bad,
    })
    assert.equal(v.blocked, true, String(bad))
    assert.equal(v.reason, 'last_admin')
  }
})
