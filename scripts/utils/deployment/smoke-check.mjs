#!/usr/bin/env node
/**
 * 배포 후 스모크 헬스체크
 *
 * 사용법:
 *   node scripts/utils/deployment/smoke-check.mjs <baseUrl>
 *   node scripts/utils/deployment/smoke-check.mjs https://ggac.kr
 *
 * 핵심 엔드포인트를 순차 GET 하여 엔드포인트별 기대 상태를 판정한다:
 *   - 페이지(/, /board): status < 400 기대 (2xx·3xx OK, 4xx·5xx 실패)
 *   - API(/api/health, /api/posts): status === 200 기대 (404·4xx·5xx 실패)
 *   - /api/health: 추가로 { success:true, typeof data.status==='string' } 계약 확인
 *
 * status<500만 보면 핵심 라우트가 제거돼 404가 나도 조용히 통과하므로,
 * 배포 회귀(경로 제거·라우팅 파손)를 감지하도록 기대 상태를 명시한다.
 * 하나라도 실패하면 기대/실제 상태를 출력하고 exit 1. Node 내장 fetch(18+)만.
 */

const baseArg = process.argv[2] || process.env.SMOKE_BASE_URL || 'https://ggac.kr'
const baseUrl = baseArg.replace(/\/+$/, '')

const TIMEOUT_MS = 15000

// 기대 상태 판정기: 'lt400'(페이지, 2xx·3xx) | 'eq200'(API) | 커스텀 함수
const EXPECT = {
  lt400: { label: '<400', test: status => status < 400 },
  eq200: { label: '===200', test: status => status === 200 },
}

const ENDPOINTS = [
  { path: '/', expect: EXPECT.lt400 },
  { path: '/board', expect: EXPECT.lt400 },
  { path: '/api/health', expect: EXPECT.eq200, contract: 'health' },
  { path: '/api/posts', expect: EXPECT.eq200 },
]

async function checkEndpoint({ path, expect, contract }) {
  const url = `${baseUrl}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'ggac-smoke-check' },
    })

    if (!expect.test(res.status)) {
      return { path, ok: false, reason: `기대 ${expect.label}, 실제 status ${res.status}` }
    }

    if (contract === 'health') {
      let body
      try {
        body = await res.json()
      } catch {
        return {
          path,
          ok: false,
          reason: `기대 ${expect.label} 만족(${res.status})이나 health 응답이 JSON이 아님`,
        }
      }
      if (!body || body.success !== true || !body.data || typeof body.data.status !== 'string') {
        return {
          path,
          ok: false,
          reason: `status ${res.status}이나 health 계약 불일치: ${JSON.stringify(body)}`,
        }
      }
      return {
        path,
        ok: true,
        reason: `status ${res.status} (기대 ${expect.label}), health=${body.data.status}, db=${body.data.db}`,
      }
    }

    return { path, ok: true, reason: `status ${res.status} (기대 ${expect.label})` }
  } catch (err) {
    return {
      path,
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`[smoke] base: ${baseUrl}`)
  const results = []
  for (const ep of ENDPOINTS) {
    const result = await checkEndpoint(ep)
    results.push(result)
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.path} — ${result.reason}`)
  }

  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.error(`\n[smoke] 실패 ${failed.length}/${results.length}:`)
    for (const f of failed) {
      console.error(`  - ${f.path}: ${f.reason}`)
    }
    process.exit(1)
  }

  console.log(`\n[smoke] 전체 통과 (${results.length}/${results.length})`)
}

main().catch(err => {
  console.error('[smoke] 예기치 못한 오류:', err)
  process.exit(1)
})
