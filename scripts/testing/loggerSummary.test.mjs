import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 운영 로그에서 **크론이 무엇을 했는지** 한 줄로 보이게 하는 계약.
 *
 * `createLogger`의 `info`는 운영(`NODE_ENV !== 'development'`)에서 지워진다. 그래서 `info`로 남긴 크론 요약은 Vercel
 * 로그에 한 줄도 남지 않는다 — 2026-11-05에 이 사실이 드러나 `summary` 레벨을 만들었는데, 바로 다음 커밋에서 그
 * 수정이 통째로 되돌아갔다(테스트까지 함께 사라져 아무도 몰랐다). 그래서 이 파일이 두 가지를 동시에 못박는다.
 *
 * 1. `summary`는 운영에서도 남고 `info`는 지워진다(런타임).
 * 2. 크론 요약 줄이 다시 `log.info`로 돌아가지 않는다(소스 계약).
 *
 * 2번은 소스 텍스트만 보는 정적 검사다 — 실행 경로를 보지 않는다(`assert-runtime-risks.mjs`의 한계와 같다).
 * 그래도 이 회귀는 정확히 "문자열이 info로 바뀐" 형태였으므로 여기서 잡힌다.
 */

// 운영 모드로 불러온다 — Logger는 만들어질 때 NODE_ENV를 읽는다.
process.env.NODE_ENV = 'production'
const { createLogger } = await import('../../src/utils/logger.ts')

function capture(fn) {
  // `summary`는 stderr(console.warn)로 낸다 — 이 프로젝트의 런타임 로그에는 stdout이 실리지 않는다(2026-11-06 실측).
  const originalWarn = console.warn
  const lines = []
  console.warn = (...args) => lines.push(args)
  try {
    fn()
  } finally {
    console.warn = originalWarn
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

/** 매 실행(또는 할 일이 있을 때) "무엇을 했는지"를 남기는 크론 요약 줄. */
const CRON_SUMMARIES = [
  ['src/app/api/internal/mailbox/backfill/route.ts', '메일함 크론 요약'],
  ['src/app/api/internal/dues/charge/route.ts', '자동결제 실행 완료'],
  ['src/app/api/internal/dues/expire/route.ts', '조합비 결제 대사'],
  ['src/app/api/internal/tickets/expire/route.ts', '예매 선점 정리'],
  ['src/app/api/internal/funding/expire/route.ts', '후원 만료 정리'],
  ['src/app/api/internal/market/close-auctions/route.ts', '마감 경매 닫기'],
]

test('크론 요약 줄은 log.summary로 남긴다 — log.info로 돌아가면 운영 로그에서 사라진다', () => {
  for (const [file, label] of CRON_SUMMARIES) {
    const source = readFileSync(file, 'utf8')
    assert.ok(
      source.includes(`log.summary('${label}'`),
      `${file}의 "${label}" 요약이 log.summary가 아니다 — 운영에서 이 줄이 남지 않는다`
    )
    assert.ok(
      !source.includes(`log.info('${label}'`),
      `${file}의 "${label}" 요약이 log.info로 돌아갔다 — 운영에서 이 줄이 남지 않는다`
    )
  }
})
