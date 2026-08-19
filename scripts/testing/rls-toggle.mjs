/**
 * 로컬 Supabase 스택의 RLS를 일괄로 끄고/켠다.
 *
 *   node scripts/testing/rls-toggle.mjs status
 *   node scripts/testing/rls-toggle.mjs off
 *   node scripts/testing/rls-toggle.mjs on
 *
 * 왜 필요한가: 단계 2b-4에서 Better Auth로 전환하면 Supabase 쿠키 세션이
 * 사라지고 `auth.uid()`가 NULL이 된다 — 운영 정책 58개 중 52개가 그 함수에
 * 의존하므로 전부 거짓이 된다. "앱 계층이 스스로 막고 있는가"는 RLS를 끈
 * 상태로 권한 E2E를 돌려야만 판정할 수 있다. RLS가 켜진 채로 초록인 것은
 * 아무 증거도 되지 않는다.
 *
 * 안전장치: 접속 대상 호스트가 127.0.0.1/localhost가 아니면 즉시 거부한다.
 * 이 가드가 없으면 한 번의 실수로 운영 RLS가 꺼진다.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const STATE_FILE = 'scripts/testing/.rls-state.json'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function localDbUrl() {
  const url = process.env.E2E_DATABASE_URL
  if (!url) {
    throw new Error(
      'E2E_DATABASE_URL이 없다. 로컬 스택의 값을 넣어라 ' +
        '(예: postgresql://postgres:postgres@127.0.0.1:54422/postgres)'
    )
  }
  const { hostname } = new URL(url)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`로컬이 아닌 호스트에는 실행하지 않는다: ${hostname}`)
  }
  return url
}

/** psql을 한 번 실행하고 표준출력을 돌려준다. 결과는 탭 구분, 헤더 없음. */
function psql(url, sql) {
  return execFileSync('psql', [url, '-At', '-F', '\t', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 지금 RLS가 켜져 있는 public 테이블 목록. */
function enabledTables(url) {
  const sql = `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname`
  return psql(url, sql).split('\n').filter(Boolean)
}

function main() {
  const command = process.argv[2]
  if (!['off', 'on', 'status'].includes(command)) {
    console.error('usage: node scripts/testing/rls-toggle.mjs <off|on|status>')
    process.exit(1)
  }

  const url = localDbUrl()

  if (command === 'status') {
    const on = enabledTables(url)
    console.log(`RLS 켜진 테이블: ${on.length}개`)
    if (on.length > 0) console.log('  ' + on.join(', '))
    return
  }

  if (command === 'off') {
    const on = enabledTables(url)
    if (on.length === 0) {
      console.log('이미 전부 꺼져 있다. 상태 파일을 덮어쓰지 않는다.')
      return
    }
    // 끄기 전에 먼저 저장한다 — 저장 실패 시 복원 불가능한 상태가 되면 안 된다.
    writeFileSync(STATE_FILE, JSON.stringify({ enabled: on }, null, 2))
    for (const table of on) {
      psql(url, `ALTER TABLE "public"."${table}" DISABLE ROW LEVEL SECURITY`)
    }
    console.log(`RLS 껐다: ${on.length}개 (원상태를 ${STATE_FILE}에 저장)`)
    return
  }

  // command === 'on'
  if (!existsSync(STATE_FILE)) {
    throw new Error(`${STATE_FILE}이 없다. 무엇을 켜야 할지 알 수 없다 — 임의로 전부 켜지 않는다.`)
  }
  const { enabled } = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  for (const table of enabled) {
    psql(url, `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`)
  }
  const still = enabledTables(url)
  console.log(`RLS 켰다: ${enabled.length}개 요청 → 현재 켜진 것 ${still.length}개`)
  if (still.length !== enabled.length) {
    throw new Error('복원 결과가 저장된 원상태와 다르다')
  }
}

main()
