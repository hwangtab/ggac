import { test } from 'node:test'
import assert from 'node:assert/strict'

// 운영 모드로 불러온다 — Logger는 만들어질 때 NODE_ENV를 읽는다.
process.env.NODE_ENV = 'production'
const { createLogger } = await import('../../src/utils/logger.ts')

function capture(fn) {
  const original = console.info
  const lines = []
  console.info = (...args) => lines.push(args)
  try {
    fn()
  } finally {
    console.info = original
  }
  return lines
}

test('운영에서 summary는 남고 info는 지워진다 — 크론 요약은 summary로 남겨야 Vercel 로그에 보인다', () => {
  const log = createLogger('mailbox-cron')
  const lines = capture(() => {
    log.info('보이면 안 되는 줄')
    log.summary('메일함 크론 요약', { snoozeWoken: 1 })
  })
  assert.deepEqual(lines, [['[mailbox-cron] 메일함 크론 요약', { snoozeWoken: 1 }]])
})
