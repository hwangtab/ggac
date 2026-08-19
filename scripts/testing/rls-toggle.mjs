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
 * 실행 경로: psql은 호스트가 아니라 `docker exec <컨테이너> psql`로 실행한다
 * (호스트에 psql 설치가 필요 없다). 이 방식이 안전한 이유는 컨테이너 이름
 * 자체가 아니라, 아래 세 가드를 모두 통과해야만 ALTER TABLE에 도달하기
 * 때문이다:
 *   1) E2E_DATABASE_URL이 존재하고 그 호스트가 127.0.0.1/localhost/::1이다.
 *   2) Docker 엔드포인트(DOCKER_HOST 또는 현재 docker context)가
 *      unix:// 소켓이거나 127.0.0.1/localhost를 가리킨다 — 원격 Docker
 *      데몬에는 실행하지 않는다.
 *   3) 대상 컨테이너가 Supabase CLI가 붙이는 `com.supabase.cli.project`
 *      라벨을 갖고 있다 — 아무 컨테이너 이름이나 대신 넣을 수 없다.
 * 세 가드 중 하나라도 실패하면 ALTER TABLE 이전에 즉시 거부한다.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

const STATE_FILE = 'scripts/testing/.rls-state.json'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const DB_CONTAINER = process.env.E2E_DB_CONTAINER || 'supabase_db_ggac'
const SUPABASE_CLI_LABEL = 'com.supabase.cli.project'

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

/** unix:// 소켓이거나 호스트명이 127.0.0.1/localhost/::1이면 로컬 엔드포인트로 본다. */
function isLocalDockerEndpoint(endpoint) {
  if (endpoint.startsWith('unix://')) return true
  try {
    const { hostname } = new URL(endpoint)
    return LOCAL_HOSTS.has(hostname)
  } catch {
    return false
  }
}

/**
 * Docker 데몬이 이 머신의 로컬 데몬인지 확인한다.
 * DOCKER_HOST가 설정돼 있으면 그 값을 검사하고, 없으면 현재 docker context가
 * 가리키는 엔드포인트를 조회해 같은 규칙을 적용한다. 둘 중 어느 쪽이든
 * 로컬이 아니면 거부한다.
 */
function assertLocalDockerHost() {
  const dockerHost = process.env.DOCKER_HOST
  if (dockerHost) {
    if (!isLocalDockerEndpoint(dockerHost)) {
      throw new Error(`DOCKER_HOST가 로컬 데몬을 가리키지 않는다: ${dockerHost}`)
    }
    return
  }
  const contextHost = execFileSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
  if (!isLocalDockerEndpoint(contextHost)) {
    throw new Error(`현재 docker context가 로컬 데몬을 가리키지 않는다: ${contextHost}`)
  }
}

/**
 * 대상 컨테이너가 Supabase CLI로 관리되는 컨테이너인지 확인한다.
 * 임의의 컨테이너 이름을 넣어 엉뚱한 DB를 건드리는 것을 막는다.
 */
function assertSupabaseManagedContainer(container) {
  let label
  try {
    label = execFileSync(
      'docker',
      ['inspect', '-f', `{{index .Config.Labels "${SUPABASE_CLI_LABEL}"}}`, container],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  } catch (err) {
    throw new Error(
      `컨테이너(${container})를 확인할 수 없다: ${(err.stderr ?? err.message).toString().trim()}`
    )
  }
  if (!label) {
    throw new Error(
      `컨테이너(${container})는 Supabase CLI가 관리하는 컨테이너가 아니다 ` +
        `(${SUPABASE_CLI_LABEL} 라벨이 없다) — 실행하지 않는다.`
    )
  }
}

/** psql을 로컬 Postgres 컨테이너 안에서 한 번 실행하고 표준출력을 돌려준다. 결과는 탭 구분, 헤더 없음. */
function psql(sql) {
  try {
    return execFileSync(
      'docker',
      ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-F', '\t', '-c', sql],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
  } catch (err) {
    if (err.code === 'ENOENT' || /No such container/.test(err.stderr ?? '')) {
      throw new Error(
        `로컬 Postgres 컨테이너(${DB_CONTAINER})에 접속할 수 없다. ` +
          'docker가 설치돼 있고 로컬 Supabase 스택이 실행 중인지 확인해라 ' +
          '(예: supabase start).'
      )
    }
    throw err
  }
}

/** 지금 RLS가 켜져 있는 public 테이블 목록. */
function enabledTables() {
  const sql = `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname`
  return psql(sql).split('\n').filter(Boolean)
}

function main() {
  const command = process.argv[2]
  if (!['off', 'on', 'status'].includes(command)) {
    console.error('usage: node scripts/testing/rls-toggle.mjs <off|on|status>')
    process.exit(1)
  }

  // E2E_DATABASE_URL 자체는 더 이상 접속에 쓰이지 않지만(접속은 docker exec로
  // 이뤄진다), "로컬을 가리키고 있다는 의도"를 명시적으로 요구하는 첫 번째
  // 가드로 그대로 둔다.
  localDbUrl()
  // 두 번째·세 번째 가드: Docker 데몬 자체가 로컬인지, 대상 컨테이너가
  // Supabase CLI 관리 컨테이너인지. 셋 다 통과해야 ALTER TABLE에 도달한다.
  assertLocalDockerHost()
  assertSupabaseManagedContainer(DB_CONTAINER)

  if (command === 'status') {
    const on = enabledTables()
    console.log(`RLS 켜진 테이블: ${on.length}개`)
    if (on.length > 0) console.log('  ' + on.join(', '))
    return
  }

  if (command === 'off') {
    if (existsSync(STATE_FILE)) {
      throw new Error(
        `${STATE_FILE}이 이미 있다. 이전 off가 끝까지 실행되지 않았을 수 있다 ` +
          `— 덮어쓰지 않는다. 'on'을 먼저 실행해 복원하거나, 상태가 낡았다고 ` +
          '확신하면 파일을 직접 지운 뒤 다시 시도해라.'
      )
    }
    const on = enabledTables()
    if (on.length === 0) {
      console.log('이미 전부 꺼져 있다. 상태 파일을 만들지 않는다.')
      return
    }
    // 끄기 전에 먼저 저장한다 — 저장 실패 시 복원 불가능한 상태가 되면 안 된다.
    writeFileSync(STATE_FILE, JSON.stringify({ enabled: on }, null, 2))
    for (const table of on) {
      psql(`ALTER TABLE "public"."${table}" DISABLE ROW LEVEL SECURITY`)
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
    psql(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`)
  }
  const still = enabledTables()
  console.log(`RLS 켰다: ${enabled.length}개 요청 → 현재 켜진 것 ${still.length}개`)
  if (still.length !== enabled.length) {
    throw new Error('복원 결과가 저장된 원상태와 다르다')
  }
  // 정상적으로 복원됐으니 다음 off/on 순환이 이어질 수 있도록 상태 파일을 지운다.
  unlinkSync(STATE_FILE)
}

main()
