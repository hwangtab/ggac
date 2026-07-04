#!/usr/bin/env node
/**
 * 배포 후 스모크 헬스체크
 *
 * 사용법:
 *   node scripts/utils/deployment/smoke-check.mjs <baseUrl>
 *   node scripts/utils/deployment/smoke-check.mjs https://ggac.kr
 *
 * 핵심 엔드포인트를 순차 GET 하여:
 *   - 각 응답 상태코드가 < 500 인지
 *   - /api/health 가 { success: true, data.status } 형태인지
 * 를 확인한다. 하나라도 실패하면 실패 목록을 출력하고 exit 1.
 *
 * Node 내장 fetch(18+)만 사용. 외부 의존성 없음.
 */

const baseArg = process.argv[2] || process.env.SMOKE_BASE_URL || 'https://ggac.kr'
const baseUrl = baseArg.replace(/\/+$/, '')

const ENDPOINTS = ['/', '/board', '/api/health', '/api/posts']
const TIMEOUT_MS = 15000

async function checkEndpoint(path) {
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

    if (res.status >= 500) {
      return { path, ok: false, reason: `status ${res.status}` }
    }

    if (path === '/api/health') {
      let body
      try {
        body = await res.json()
      } catch {
        return { path, ok: false, reason: 'health 응답이 JSON이 아님' }
      }
      if (!body || body.success !== true || !body.data || typeof body.data.status !== 'string') {
        return { path, ok: false, reason: `health 형식 불일치: ${JSON.stringify(body)}` }
      }
      return { path, ok: true, reason: `status ${res.status}, health=${body.data.status}, db=${body.data.db}` }
    }

    return { path, ok: true, reason: `status ${res.status}` }
  } catch (err) {
    return { path, ok: false, reason: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`[smoke] base: ${baseUrl}`)
  const results = []
  for (const path of ENDPOINTS) {
    const result = await checkEndpoint(path)
    results.push(result)
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${path} — ${result.reason}`)
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
