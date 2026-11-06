#!/usr/bin/env node
/**
 * 무인 상시 점검 (프로덕션).
 *
 * 사용법:
 *   node scripts/ops/uptime-check.mjs [baseUrl]
 *   CRON_SECRET=… node scripts/ops/uptime-check.mjs https://ggac.kr
 *
 * 두 가지를 본다.
 *
 * 1. **`/api/health`의 본문**. 이 엔드포인트는 DB가 죽어도 **200**을 돌려준다(스모크 계약이 200을 기대하기 때문).
 *    그래서 상태 코드만 보는 감시는 "DB 다운"을 정상으로 읽는다. 여기서는 `data.status === 'ok'`까지 요구한다.
 *    배포 직후 스모크(`smoke-check.mjs`)는 배포 **때 한 번** 돌 뿐이고, 배포와 무관한 장애(용량·Turso 장애·환경변수
 *    사라짐)는 아무도 보지 않았다 — 2026-11-05 사각지대 점검의 결론이다.
 *
 * 2. **`/api/internal/ops/cron-health`**. 크론 감시자 자신이 죽었는지는 감시자가 알 수 없다. 이 라우트가 감시자 행까지
 *    포함해 503을 내면 이 스크립트가 실패하고, GitHub Actions 예약 실행이 실패로 남아 소유자에게 알림이 간다.
 *    `CRON_SECRET`이 없으면 이 검사는 **건너뛴다**(로컬에서 health만 볼 때).
 *
 * 하나라도 실패하면 무엇이·왜 실패했는지 출력하고 exit 1. Node 내장 fetch(18+)만 쓴다.
 */

import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 15000

/** @typedef {{ name: string, ok: boolean, detail: string }} CheckResult */

const trimBase = value => String(value ?? '').replace(/\/+$/, '')

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

/** `/api/health` — 상태 코드가 아니라 본문의 status를 본다. */
async function checkHealth(baseUrl) {
  const { status, body } = await getJson(`${baseUrl}/api/health`)
  const health = body?.data ?? {}
  const ok = status === 200 && health.status === 'ok' && body?.success === true
  const detail = ok
    ? `status=ok, turso=${health.turso ?? '?'}, commit=${String(health.commit ?? '?').slice(0, 7)}`
    : `HTTP ${status}, status=${health.status ?? '?'}, turso=${health.turso ?? '?'}`
  return { name: 'health', ok, detail }
}

/** 크론 건강 — 감시자 자신의 생존까지 본다. 시크릿이 없으면 건너뛴다. */
async function checkCronHealth(baseUrl, cronSecret) {
  if (!cronSecret) return { name: 'cron-health', ok: true, detail: '건너뜀(CRON_SECRET 없음)' }
  const { status, body } = await getJson(`${baseUrl}/api/internal/ops/cron-health`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  })
  if (status === 401)
    return { name: 'cron-health', ok: false, detail: 'HTTP 401 — CRON_SECRET 불일치' }
  const problems = body?.data?.problems ?? []
  const ok = status === 200 && body?.data?.ok === true
  const detail = ok
    ? `크론 ${body?.data?.jobs ?? 0}개 정상`
    : problems.length > 0
      ? problems.map(p => `${p.job}:${p.kind}`).join(', ')
      : `HTTP ${status}`
  return { name: 'cron-health', ok, detail }
}

/**
 * 두 검사를 순서대로 돌려 결과를 돌려준다(던지지 않는다 — 호출부가 판정한다).
 *
 * @param {{ baseUrl?: string, cronSecret?: string }} [options]
 * @returns {Promise<CheckResult[]>}
 */
export async function runUptimeCheck(options = {}) {
  const baseUrl = trimBase(options.baseUrl ?? process.env.UPTIME_BASE_URL ?? 'https://ggac.kr')
  const cronSecret = options.cronSecret ?? process.env.CRON_SECRET ?? ''
  const results = []
  for (const check of [checkHealth, checkCronHealth]) {
    try {
      results.push(await check(baseUrl, cronSecret))
    } catch (error) {
      results.push({
        name: check === checkHealth ? 'health' : 'cron-health',
        ok: false,
        detail: `요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return results
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const results = await runUptimeCheck({ baseUrl: process.argv[2] })
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}`)
  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.error(`상시 점검 실패 ${failed.length}건 — ${failed.map(f => f.name).join(', ')}`)
    process.exit(1)
  }
  console.log('상시 점검 통과')
}
