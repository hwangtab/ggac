#!/usr/bin/env node
/**
 * CI 빌드용 최소 시드.
 *
 * 단계 4의 최종 리뷰(B-1)에서 **운영 빌드가 아티스트 조회 실패나 0건일 때 실패하도록**
 * 바꿨다. 그전에는 Turso가 죽어도 `next build`가 exit 0을 내면서 `data/artists.json`의
 * 몇 주 묵은 명단을 배포에 구워 넣었고, 아무도 그 사실을 알 수 없었다.
 *
 * 그 가드의 부작용으로 **CI 빌드에도 아티스트가 최소 1행 있는 DB가 필요해졌다.**
 * 그렇다고 CI에 운영 Turso 자격증명을 주는 것은 방향이 반대다 — CI가 운영 DB를
 * 읽을 이유가 없고, 토큰이 하나 더 새는 자리만 는다.
 *
 * 그래서 CI는 `drizzle-kit push`로 만든 **로컬 파일 DB**에 이 스크립트로 최소 행을
 * 심고 그걸 상대로 빌드한다. `file:` URL은 `assertProductionCredentials()`가
 * `TURSO_AUTH_TOKEN`을 요구하지 않는 경로다(원격일 때만 요구).
 *
 * **여기서 심는 것은 "빌드가 통과할 최소치"이지 운영 데이터의 사본이 아니다.**
 * 화면 내용을 검증하려면 e2e(`seed-authz-fixtures.mjs`)를 써라.
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL이 없다.')
  process.exit(2)
}
if (!url.startsWith('file:')) {
  // 운영·원격에 실수로 심는 것을 구조적으로 막는다.
  console.error(`안전장치: 파일 DB에만 심는다. 받은 URL의 스킴이 file:이 아니다.`)
  process.exit(2)
}

const client = createClient({ url })
const now = Date.now()

/**
 * 아티스트 상세 페이지가 `generateStaticParams`로 프리렌더되므로 slug가 실제로
 * 쓰인다. 운영 데이터를 흉내 내지 않도록 명백히 픽스처임을 알 수 있는 값을 쓴다.
 */
const ARTISTS = [
  { id: 'ci-fixture-1', legacyId: 'ci-1', slug: 'ci-fixture-one', name: 'CI 픽스처 1' },
  { id: 'ci-fixture-2', legacyId: 'ci-2', slug: 'ci-fixture-two', name: 'CI 픽스처 2' },
]

for (const a of ARTISTS) {
  await client.execute({
    sql: `INSERT INTO artists (id, legacy_id, slug, name, category, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name`,
    args: [a.id, a.legacyId, a.slug, a.name, JSON.stringify(['음악']), now, now],
  })
}

const { rows } = await client.execute('SELECT COUNT(*) AS n FROM artists')
console.log(`빌드 픽스처 시드 완료 — artists ${rows[0].n}행`)
client.close()
