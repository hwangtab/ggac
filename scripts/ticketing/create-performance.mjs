#!/usr/bin/env node
/**
 * 예매용 공연을 하나 등록한다.
 *
 * 관리자 화면이 생기기 전까지 쓰는 도구다. 공연 정보를 손으로 SQL에 넣으면
 * 회차·티켓 종류의 연결을 빠뜨리기 쉬워서, 한 번에 일관되게 만들도록 묶었다.
 *
 * 사용법:
 *   node scripts/ticketing/create-performance.mjs --file scripts/ticketing/sample.json
 *   node scripts/ticketing/create-performance.mjs --file ... --db "libsql://..." --token "..."
 *
 * `--db`를 주지 않으면 `.env.local`의 `TURSO_DATABASE_URL`을 쓴다.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { randomUUID } from 'node:crypto'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) continue
    args[argv[i].slice(2)] = argv[i + 1]
  }
  return args
}

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const idx = trimmed.indexOf('=')
      env[trimmed.slice(0, idx).trim()] = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^"|"$/g, '')
    }
  } catch {
    /* .env.local이 없어도 --db로 지정하면 된다 */
  }
  return env
}

const args = parseArgs(process.argv)
if (!args.file) {
  console.error('사용법: --file <공연 정의 JSON> [--db <url>] [--token <token>]')
  process.exit(1)
}

const env = loadEnv()
const url = args.db || env.TURSO_DATABASE_URL
const authToken = args.token || env.TURSO_AUTH_TOKEN
if (!url) {
  console.error('TURSO_DATABASE_URL이 없다. --db로 지정하거나 .env.local을 준비해라.')
  process.exit(1)
}

const spec = JSON.parse(readFileSync(args.file, 'utf8'))
for (const field of ['slug', 'title', 'shows', 'ticketTypes']) {
  if (!spec[field]) {
    console.error(`공연 정의에 ${field}가 없다.`)
    process.exit(1)
  }
}

const client = createClient({ url, authToken })
const now = Date.now()

// 같은 slug가 이미 있으면 멈춘다 — 덮어쓰면 이미 팔린 표의 회차가 사라진다.
const existing = await client.execute({
  sql: 'SELECT id FROM performances WHERE slug = ?',
  args: [spec.slug],
})
if (existing.rows.length > 0) {
  console.error(`slug "${spec.slug}"인 공연이 이미 있다. 다른 slug를 쓰거나 기존 공연을 고쳐라.`)
  process.exit(1)
}

const performanceId = randomUUID()
const statements = [
  {
    sql: `INSERT INTO performances
            (id, slug, title, summary, description, venue, poster_image, status, notice_text, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      performanceId,
      spec.slug,
      spec.title,
      spec.summary ?? null,
      spec.description ?? null,
      spec.venue ?? null,
      spec.posterImage ?? null,
      spec.status ?? 'open',
      spec.noticeText ?? null,
      now,
      now,
    ],
  },
]

for (const show of spec.shows) {
  const startsAt = new Date(show.startsAt).getTime()
  if (Number.isNaN(startsAt)) {
    console.error(`회차 시각을 해석할 수 없다: ${show.startsAt}`)
    process.exit(1)
  }
  statements.push({
    sql: `INSERT INTO performance_shows (id, performance_id, starts_at, capacity, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), performanceId, startsAt, Number(show.capacity), now, now],
  })
}

spec.ticketTypes.forEach((type, index) => {
  statements.push({
    sql: `INSERT INTO ticket_types
            (id, performance_id, name, price, max_per_order, members_only, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      performanceId,
      type.name,
      Number(type.price),
      Number(type.maxPerOrder ?? 4),
      type.membersOnly ? 1 : 0,
      index,
      now,
      now,
    ],
  })
})

await client.batch(statements, 'write')

console.log(`공연 등록 완료: ${spec.title}`)
console.log(`  주소: /tickets/${spec.slug}`)
console.log(`  회차 ${spec.shows.length}개, 티켓 종류 ${spec.ticketTypes.length}개`)
client.close()
