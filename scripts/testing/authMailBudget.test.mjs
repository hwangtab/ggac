import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTH_MAIL_BUDGET_WINDOW_MS,
  DEFAULT_AUTH_MAIL_DAILY_LIMIT,
  DEFAULT_AUTH_MAIL_PER_RECIPIENT_DAILY,
  GLOBAL_BUDGET_KEY,
  authMailLimits,
  checkAuthMailBudget,
  recipientBudgetKey,
} from '../../src/lib/auth/mailBudget.ts'

/** 메모리 카운터 — 실제 Upstash 대신. 호출 기록도 남긴다. */
function fakeStore() {
  const counts = new Map()
  const calls = []
  const consume = async (key, windowMs, max) => {
    calls.push({ key, windowMs, max })
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return n <= max
  }
  return { consume, counts, calls }
}

test('기본 한도: 전체 하루 30통, 수신자별 하루 3통', () => {
  assert.deepEqual(authMailLimits({}), {
    global: DEFAULT_AUTH_MAIL_DAILY_LIMIT,
    perRecipient: DEFAULT_AUTH_MAIL_PER_RECIPIENT_DAILY,
  })
  assert.equal(DEFAULT_AUTH_MAIL_DAILY_LIMIT, 30)
  assert.equal(DEFAULT_AUTH_MAIL_PER_RECIPIENT_DAILY, 3)
})

test('환경변수는 0 이상의 정수만 받고 잘못된 값은 기본값이다', () => {
  assert.deepEqual(
    authMailLimits({ AUTH_MAIL_DAILY_LIMIT: '50', AUTH_MAIL_PER_RECIPIENT_DAILY: '5' }),
    { global: 50, perRecipient: 5 }
  )
  for (const bad of ['abc', '-1', '1.5', '', '  ']) {
    assert.deepEqual(
      authMailLimits({ AUTH_MAIL_DAILY_LIMIT: bad, AUTH_MAIL_PER_RECIPIENT_DAILY: bad }),
      { global: 30, perRecipient: 3 },
      JSON.stringify(bad)
    )
  }
})

test('한도 안에서는 허용하고 한 번에 수신자·전체 카운터를 각각 하루 창으로 올린다', async () => {
  const { consume, calls } = fakeStore()
  const verdict = await checkAuthMailBudget(consume, 'member@example.com', {})
  assert.deepEqual(verdict, { allowed: true })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].key, recipientBudgetKey('member@example.com'))
  assert.equal(calls[1].key, GLOBAL_BUDGET_KEY)
  for (const c of calls) assert.equal(c.windowMs, AUTH_MAIL_BUDGET_WINDOW_MS)
  assert.equal(calls[0].max, 3)
  assert.equal(calls[1].max, 30)
})

test('같은 주소에 4번째 메일은 막는다 — 표적 메일 폭탄', async () => {
  const { consume } = fakeStore()
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await checkAuthMailBudget(consume, 'victim@example.com', {}), {
      allowed: true,
    })
  }
  assert.deepEqual(await checkAuthMailBudget(consume, 'victim@example.com', {}), {
    allowed: false,
    scope: 'recipient',
  })
})

test('수신자 한도에 걸린 요청은 전체 예산을 소모하지 않는다 — 한 사람 겨냥이 모두의 재설정을 막지 못하게', async () => {
  const { consume, counts } = fakeStore()
  for (let i = 0; i < 3; i++) await checkAuthMailBudget(consume, 'victim@example.com', {})
  const globalAfterAllowed = counts.get(GLOBAL_BUDGET_KEY)
  assert.equal(globalAfterAllowed, 3)

  // 폭탄 100번. 전부 수신자 한도에서 막혀야 하고 전체 카운터는 그대로여야 한다.
  for (let i = 0; i < 100; i++) {
    const v = await checkAuthMailBudget(consume, 'victim@example.com', {})
    assert.equal(v.allowed, false)
  }
  assert.equal(counts.get(GLOBAL_BUDGET_KEY), globalAfterAllowed)

  // 다른 조합원은 여전히 받는다.
  assert.deepEqual(await checkAuthMailBudget(consume, 'other@example.com', {}), { allowed: true })
})

test('서로 다른 주소로 퍼뜨려도 전체 하루 한도에서 멈춘다 — 쿼터 보호', async () => {
  const { consume } = fakeStore()
  let allowed = 0
  let blockedGlobal = 0
  for (let i = 0; i < 100; i++) {
    const v = await checkAuthMailBudget(consume, `bot${i}@example.com`, {})
    if (v.allowed) allowed += 1
    else if (v.scope === 'global') blockedGlobal += 1
  }
  assert.equal(allowed, 30, 'Resend 하루 100통 중 30통까지만 나간다')
  assert.equal(blockedGlobal, 70)
})

test('한도 0은 인증 메일 전면 차단이다 — 기본값으로 바뀌지 않는다', async () => {
  const { consume, calls } = fakeStore()
  assert.deepEqual(
    await checkAuthMailBudget(consume, 'a@example.com', { AUTH_MAIL_DAILY_LIMIT: '0' }),
    {
      allowed: false,
      scope: 'global',
    }
  )
  assert.deepEqual(
    await checkAuthMailBudget(consume, 'a@example.com', { AUTH_MAIL_PER_RECIPIENT_DAILY: '0' }),
    { allowed: false, scope: 'recipient' }
  )
  assert.equal(calls.length, 0, '차단이면 카운터도 건드리지 않는다')
})

test('카운터 키에 주소를 평문으로 남기지 않고 대소문자·공백과 무관하다', () => {
  const key = recipientBudgetKey('  Member@Example.COM ')
  assert.equal(key, recipientBudgetKey('member@example.com'))
  assert.ok(!key.toLowerCase().includes('member'))
  assert.ok(!key.includes('@'))
  assert.notEqual(key, recipientBudgetKey('other@example.com'))
})
