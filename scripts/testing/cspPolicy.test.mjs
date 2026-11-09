import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { buildCsp, reportingEndpointsValue } = require('../../src/config/cspPolicy.js')

// 정리 이전(2026-11-09)의 운영 CSP 전문. 의도한 변경은 report-to 그룹 이름 하나뿐이다.
const OLD_PROD = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.tosspayments.com https://challenges.cloudflare.com",
  "script-src-elem 'self' 'unsafe-inline' https://*.tosspayments.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: blob: data:",
  "media-src 'self' https://www.youtube.com https://r8qnr9c7mestxusj.public.blob.vercel-storage.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://*.tosspayments.com https://challenges.cloudflare.com",
  "connect-src 'self' https://*.tosspayments.com https://vercel.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.tosspayments.com",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'report-uri /api/security/csp-report',
  'report-to default',
].join('; ')

test('운영 CSP는 의도한 변경(report-to 그룹) 외에는 예전 문자열과 같다', () => {
  assert.equal(buildCsp(), OLD_PROD.replace('report-to default', 'report-to csp-endpoint'))
})

test('upgradeInsecure·officeOrigin·dev 분기', () => {
  assert.ok(buildCsp({ upgradeInsecure: true }).endsWith('; upgrade-insecure-requests'))
  assert.ok(
    buildCsp({ officeOrigin: 'https://o.example' }).includes(
      'challenges.cloudflare.com https://o.example;'
    )
  )
  const dev = buildCsp({ dev: true })
  assert.match(dev, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/)
  assert.match(dev, /ws:\/\/localhost:\*/)
  assert.doesNotMatch(buildCsp(), /unsafe-eval/)
})

test('report-to 그룹이 Reporting-Endpoints 키와 맞는다', () => {
  assert.equal(reportingEndpointsValue(), 'csp-endpoint="/api/security/csp-report"')
  assert.equal(
    reportingEndpointsValue('https://ggac.kr/path'),
    'csp-endpoint="https://ggac.kr/api/security/csp-report"'
  )
  assert.equal(reportingEndpointsValue('not a url'), 'csp-endpoint="/api/security/csp-report"')
})

test('next.config.js와 미들웨어가 모두 공유 모듈을 쓴다(사본이 되살아나지 않는다)', () => {
  const cfg = readFileSync('next.config.js', 'utf8')
  const mw = readFileSync('src/middleware/csp.ts', 'utf8')
  assert.match(cfg, /require\('\.\/src\/config\/cspPolicy'\)/)
  assert.match(mw, /from '@\/config\/cspPolicy'/)
  for (const src of [cfg, mw]) assert.doesNotMatch(src, /frame-ancestors/)
  assert.doesNotMatch(cfg, /key: 'Report-To'/)
  assert.match(cfg, /key: 'X-XSS-Protection',\s*value: '0'/)
})

test('next.config.js의 정적 CSP 헤더가 같은 입력에서 buildCsp와 같은 문자열이다', async () => {
  const saved = { ...process.env }
  process.env.NODE_ENV = 'production'
  delete process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN
  try {
    const cfg = require('../../next.config.js')
    const groups = await cfg.headers()
    const csp = groups.flatMap(g => g.headers).find(h => h.key === 'Content-Security-Policy')
    assert.equal(csp.value, buildCsp({ dev: false }))
    const re = groups.flatMap(g => g.headers).find(h => h.key === 'Reporting-Endpoints')
    assert.match(re.value, /^csp-endpoint="/)
  } finally {
    process.env = saved
  }
})
