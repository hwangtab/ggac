import { test } from 'node:test'
import assert from 'node:assert/strict'

import { logSecurityEvent } from '../../src/utils/security.ts'

/**
 * 'high' 보안 이벤트가 실제로 어딘가에 닿는지.
 *
 * 이 저장소에서 'high'는 "사람이 봐야 한다"는 뜻이다 — 레이트리밋 메모리
 * 폴백, 정체된 결제 선점, 깨진 크론이 모두 여기로 온다. 그런데 알림 웹훅
 * 환경변수(`SECURITY_ALERT_WEBHOOK_URL`)는 어디에도 설정돼 있지 않아서,
 * 실제로 닿는 곳은 stderr 한 줄뿐이다. 그 한 줄이 프로덕션 분기 안에 갇혀
 * 있으면 남는 통로가 0이 된다.
 */
function captureConsoleError() {
  const calls = []
  const original = console.error
  console.error = (...args) => calls.push(args)
  return {
    calls,
    restore() {
      console.error = original
    },
  }
}

function captureFetch() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response('{}', { status: 200 })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

test("'high'는 프로덕션이 아니어도 stderr에 남는다", () => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const c = captureConsoleError()
  try {
    logSecurityEvent('FUNDING_EXPIRE_CRON_FAILED', { error: 'boom' }, 'high')
  } finally {
    c.restore()
    process.env.NODE_ENV = prev
  }
  assert.equal(c.calls.length, 1)
  assert.match(String(c.calls[0][0]), /CRITICAL SECURITY EVENT/)
  assert.match(String(c.calls[0][0]), /FUNDING_EXPIRE_CRON_FAILED/)
})

test("'medium'은 stderr를 쓰지 않는다", () => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const c = captureConsoleError()
  try {
    logSecurityEvent('MAILBOX_RECIPIENT_NOT_ALLOWED', { resendEmailId: 'x' }, 'medium')
  } finally {
    c.restore()
    process.env.NODE_ENV = prev
  }
  assert.equal(c.calls.length, 0)
})

test('프로덕션이 아니면 외부 채널로 보내지 않는다', () => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  process.env.SECURITY_ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert'
  const c = captureConsoleError()
  const f = captureFetch()
  try {
    logSecurityEvent('FUNDING_EXPIRE_CRON_FAILED', { error: 'boom' }, 'high')
  } finally {
    f.restore()
    c.restore()
    delete process.env.SECURITY_ALERT_WEBHOOK_URL
    process.env.NODE_ENV = prev
  }
  assert.equal(f.calls.length, 0)
})

test('logSecurityEvent는 던지지 않는다 — 호출부 흐름을 끊지 않는다', () => {
  // 알림 실패가 요청을 죽이면 "보안 로그를 남겼더니 서비스가 멈췄다"가 된다.
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  process.env.SECURITY_ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert'
  const c = captureConsoleError()
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
  try {
    assert.doesNotThrow(() =>
      logSecurityEvent('FUNDING_EXPIRE_CRON_FAILED', { error: 'boom' }, 'high')
    )
  } finally {
    globalThis.fetch = original
    c.restore()
    delete process.env.SECURITY_ALERT_WEBHOOK_URL
    process.env.NODE_ENV = prev
  }
})
