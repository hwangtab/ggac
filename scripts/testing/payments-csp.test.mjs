import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 결제창이 열리려면 CSP가 토스 도메인을 허용해야 한다.
 *
 * 이 검사가 없으면, 나중에 누군가 CSP를 정리하다 토스 항목을 지워도 아무
 * 테스트도 깨지지 않는다. 그리고 그 사고는 **결제창이 안 뜬다**는 형태로만
 * 드러나서 원인을 찾는 데 오래 걸린다.
 *
 * CSP는 두 곳에 있다 — 정적 헤더(`next.config.js`)와 미들웨어(`src/middleware/csp.ts`).
 * 한쪽만 고치면 경로에 따라 결제창이 뜨다 말다 한다. 그래서 둘 다 검사한다.
 */

const SOURCES = [
  ['next.config.js', readFileSync('next.config.js', 'utf8')],
  ['src/middleware/csp.ts', readFileSync('src/middleware/csp.ts', 'utf8')],
]

/** 지시문 한 줄을 찾아 돌려준다. dev/prod 분기가 있으면 여러 줄이 잡힌다. */
function directiveLines(source, directive) {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes(`${directive} `) && line.includes("'self'"))
}

for (const [name, source] of SOURCES) {
  test(`${name}: 결제창을 띄울 수 있게 frame-src가 토스를 허용한다`, () => {
    const lines = directiveLines(source, 'frame-src')
    assert.ok(lines.length > 0, 'frame-src 지시문을 찾지 못했다')
    for (const line of lines) {
      assert.match(line, /tosspayments\.com/, `frame-src에 토스가 없다: ${line}`)
    }
  })

  test(`${name}: 결제 API를 부를 수 있게 connect-src가 토스를 허용한다`, () => {
    const lines = directiveLines(source, 'connect-src')
    assert.ok(lines.length > 0, 'connect-src 지시문을 찾지 못했다')
    for (const line of lines) {
      assert.match(line, /tosspayments\.com/, `connect-src에 토스가 없다: ${line}`)
    }
  })

  test(`${name}: 카드사 인증으로 넘어갈 수 있게 form-action이 토스를 허용한다`, () => {
    // 결제창은 카드사 인증 페이지로 폼을 제출한다. form-action이 'self'만이면
    // 카드를 넣은 뒤 인증 단계에서 조용히 막힌다.
    const lines = directiveLines(source, 'form-action')
    assert.ok(lines.length > 0, 'form-action 지시문을 찾지 못했다')
    for (const line of lines) {
      assert.match(line, /tosspayments\.com/, `form-action에 토스가 없다: ${line}`)
    }
  })
}
