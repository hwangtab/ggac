import { defineConfig } from 'drizzle-kit'

/**
 * **운영 DB를 향한 `drizzle-kit push`를 막는다.**
 *
 * 적대 감사(2026-08-27)가 실증했다 — `drizzle-kit push` 한 번이 성능 인덱스
 * **23개를 전부 지운다**(실측: 23 → 0, 계획이 `SEARCH` → `SCAN`). 원인은
 * `0004`·`0005`가 만든 인덱스가 Drizzle 스키마에 `index()`로 선언돼 있지
 * 않아서, push가 그것들을 "스키마에 없는 잉여"로 보고 제거하기 때문이다.
 *
 * 그런데 `scripts/turso/README.md`가 `.env.local`을 셸에 로드한 뒤 push하라고
 * 안내했고(= 원격 운영 URL), `package.json`의 `db:push`에도 가드가 없었다.
 * 즉 **문서를 따르는 것만으로 전 조합원의 로그인·게시판 속도가 날아가고,
 * 알아챌 장치가 하나도 없다.**
 *
 * 스키마 변경은 `src/db/migrations/`의 마이그레이션으로 한다(`0002`~`0005`가
 * 그 방식이고 적용 절차가 README에 있다). push는 **로컬 개발·CI 전용**이다.
 *
 * 이 가드를 우회해야 할 정당한 이유가 생기면, 인덱스를 스키마에 `index()`로
 * 선언해 push가 지우지 않게 만드는 것이 먼저다 — 가드를 지우는 게 아니라.
 */
const url = process.env.TURSO_DATABASE_URL || 'file:local.db'

function isLocalTarget(target: string): boolean {
  if (target.startsWith('file:')) return true
  try {
    const { hostname } = new URL(target)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    // URL로 파싱되지 않는 값은 로컬로 취급하지 않는다 — 모호하면 막는다.
    return false
  }
}

if (!isLocalTarget(url) && process.env.DRIZZLE_ALLOW_REMOTE_PUSH !== 'i-know-this-drops-indexes') {
  throw new Error(
    'drizzle-kit이 원격 DB를 가리키고 있다.\n' +
      '\n' +
      'push는 스키마에 선언되지 않은 인덱스를 지운다 — 이 저장소의 성능 인덱스 23개가\n' +
      '전부 그 대상이다(0004·0005가 만들고 스키마에는 없다). 운영에 push하면 로그인과\n' +
      '게시판 조회가 전수 스캔으로 되돌아가고, 아무 에러도 나지 않는다.\n' +
      '\n' +
      '스키마 변경은 src/db/migrations/의 마이그레이션으로 해라 —\n' +
      '적용 절차는 scripts/turso/README.md에 있다.\n' +
      '\n' +
      '로컬에 push하려면 TURSO_DATABASE_URL을 file: 또는 루프백으로 지정해라.'
  )
}

export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
