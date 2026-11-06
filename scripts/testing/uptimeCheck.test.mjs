import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runUptimeCheck } from '../ops/uptime-check.mjs'

/**
 * 상시 점검 스크립트의 판정 — "상태 코드만 보는 감시는 다운을 정상으로 읽는다"가 핵심 단정이다.
 * `/api/health`는 DB가 죽어도 200을 돌려주는 계약(배포 스모크가 200을 기대한다)이라, 본문을 보지 않으면
 * 무의미한 감시가 된다.
 */

function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('health: 정상이면 통과', async () => {
  const f = stubFetch(() =>
    json({ success: true, data: { status: 'ok', turso: 'ok', commit: 'abcdef1234' } })
  )
  try {
    const [health] = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: '' })
    assert.equal(health.ok, true)
    assert.match(health.detail, /status=ok/)
  } finally {
    f.restore()
  }
})

test('health: **200이어도** status가 degraded면 실패', async () => {
  // 이 단정이 요점이다 — Turso가 죽어도 /api/health는 200을 준다.
  const f = stubFetch(() =>
    json({ success: true, data: { status: 'degraded', db: 'error', turso: 'error' } })
  )
  try {
    const [health] = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: '' })
    assert.equal(health.ok, false)
    assert.match(health.detail, /degraded/)
  } finally {
    f.restore()
  }
})

test('cron-health: 503이면 실패하고 어느 크론인지 알려 준다', async () => {
  const f = stubFetch(url =>
    url.endsWith('/api/health')
      ? json({ success: true, data: { status: 'ok' } })
      : json(
          {
            success: false,
            data: { ok: false, problems: [{ job: 'cron-watchdog', kind: 'stale' }] },
          },
          503
        )
  )
  try {
    const results = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: 's3cret' })
    const cron = results.find(r => r.name === 'cron-health')
    assert.equal(cron.ok, false)
    assert.match(cron.detail, /cron-watchdog:stale/)
  } finally {
    f.restore()
  }
})

test('cron-health: CRON_SECRET이 없으면 건너뛴다(로컬에서 health만 볼 때)', async () => {
  const f = stubFetch(() => json({ success: true, data: { status: 'ok' } }))
  try {
    const results = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: '' })
    const cron = results.find(r => r.name === 'cron-health')
    assert.equal(cron.ok, true)
    assert.match(cron.detail, /건너뜀/)
    assert.equal(f.calls.length, 1, 'cron-health는 부르지 않는다')
  } finally {
    f.restore()
  }
})

test('cron-health: 401은 시크릿 불일치로 실패', async () => {
  const f = stubFetch(url =>
    url.endsWith('/api/health')
      ? json({ success: true, data: { status: 'ok' } })
      : json({ success: false, message: '인증이 필요합니다.' }, 401)
  )
  try {
    const results = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: 'wrong' })
    const cron = results.find(r => r.name === 'cron-health')
    assert.equal(cron.ok, false)
    assert.match(cron.detail, /401/)
  } finally {
    f.restore()
  }
})

test('네트워크가 죽어도 던지지 않고 실패로 보고한다', async () => {
  const f = stubFetch(() => {
    throw new Error('network down')
  })
  try {
    const results = await runUptimeCheck({ baseUrl: 'https://example.test', cronSecret: 'x' })
    assert.equal(results.length, 2)
    for (const r of results) {
      assert.equal(r.ok, false)
      assert.match(r.detail, /network down/)
    }
  } finally {
    f.restore()
  }
})
