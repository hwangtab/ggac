// 운영 Supabase의 테이블·컬럼·RPC 목록을 PostgREST OpenAPI에서 읽어
// schema-snapshot.json으로 저장한다. 대조기(check-schema-contract.mjs)의 기준 데이터.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

// .env.local의 값을 process.env로 로드한다 (이미 설정된 값은 유지)
function loadEnvLocal() {
  const envPath = join(root, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

export function parseOpenApiToSnapshot(openapi) {
  const tables = {}
  for (const [name, def] of Object.entries(openapi.definitions ?? {})) {
    tables[name] = Object.keys(def.properties ?? {}).sort()
  }
  const rpcs = Object.keys(openapi.paths ?? {})
    .filter(p => p.startsWith('/rpc/'))
    .map(p => p.slice('/rpc/'.length))
    .sort()
  return { tables, rpcs }
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (.env.local 또는 환경변수).'
    )
    process.exit(1)
  }
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    console.error(`PostgREST OpenAPI 조회 실패: HTTP ${res.status}`)
    process.exit(1)
  }
  const parsed = parseOpenApiToSnapshot(await res.json())
  const snapshot = {
    source: 'postgrest-openapi',
    generatedAt: new Date().toISOString(),
    ...parsed,
  }
  const outPath = join(root, 'scripts/testing/schema-snapshot.json')
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(
    `schema-snapshot.json 갱신 완료: 테이블 ${Object.keys(parsed.tables).length}개, RPC ${parsed.rpcs.length}개`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
