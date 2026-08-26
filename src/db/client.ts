import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'

import * as schema from './schema/index.ts'

type Db = LibSQLDatabase<typeof schema>

/**
 * 이 가드는 원래 모듈 스코프에서 동기 throw했다. `next build`의 "Collecting
 * page data" 단계는 `/api/auth/[...all]` 라우트를 실제로 평가하는데, 그
 * 라우트가 `@/lib/auth/server` → `@/db/client`를 끌어들이면서 이 throw가
 * 빌드 자체를 죽였다(TURSO_DATABASE_URL이 없는 GitHub Actions 빌드 환경에서
 * 관측됨). 빌드는 모듈을 "평가"만 하고 실제 쿼리는 실행하지 않으므로, 검사를
 * "DB를 실제로 쓰려는 시점"까지 미뤄도 런타임 안전성은 그대로 유지된다 —
 * 자격 증명 없이 운영에서 실제로 쿼리를 시도하면 여전히 이 에러로 실패한다.
 * `file:local.db`로 조용히 폴백하는 일은 없다.
 */
/**
 * 원격 Turso 엔드포인트인가. `libsql://`·`wss://`·원격 `https://`가 여기 해당하고,
 * `file:`과 로컬 루프백(`turso dev`가 띄우는 `http://127.0.0.1:...`)은 아니다.
 * 원격만 토큰을 요구하기 위한 판정이라 **모양**으로만 가른다 — 호스트 목록을
 * 하드코딩하지 않는다.
 */
function isRemoteTursoUrl(rawUrl: string): boolean {
  const url = rawUrl.trim()
  if (!url || url.startsWith('file:')) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // 파싱되지 않는 값은 원격으로 못 박지 않는다 — 토큰 요구가 오히려
    // 거짓 실패를 만든다. 실제 연결 시점에 libsql이 제 이유로 실패한다.
    return false
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  return !isLoopback
}

function assertProductionCredentials(): void {
  if (process.env.NODE_ENV !== 'production') return

  const url = process.env.TURSO_DATABASE_URL?.trim()
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is required in production')
  }

  // 토큰은 **만료되는 물건**이다. 예전에는 URL만 봤기 때문에
  // `TURSO_AUTH_TOKEN`이 없거나 만료된 상태로도 이 가드를 통과했고, 그 실패는
  // 쿼리 시점에야 드러났다 — 그리고 `src/lib/data.ts`의 JSON 폴백이 그것을
  // 삼켜 빌드가 조용히 초록불로 끝났다(최종 리뷰 B-1). 원격 엔드포인트에서는
  // 토큰 없이 성공할 수 없으므로, 여기서 먼저 잘라 낸다.
  // 로컬 파일 DB(`file:`)와 `turso dev` 루프백은 토큰을 요구하지 않으므로
  // 제외한다 — 요구하면 그쪽이 거짓 실패가 된다.
  if (isRemoteTursoUrl(url) && !process.env.TURSO_AUTH_TOKEN?.trim()) {
    throw new Error(
      'TURSO_AUTH_TOKEN is required in production when TURSO_DATABASE_URL points at a remote Turso endpoint'
    )
  }
}

/**
 * `@/lib/server/supabaseAdmin`의 `hasServiceRoleEnv()`와 같은 목적 — 운영에서
 * `TURSO_DATABASE_URL`이 없는 상태(예: 시크릿이 없는 CI 빌드)를 실제 쿼리를
 * 시도하기 **전에** 동기적으로 판별한다. 개발/테스트 환경은 `file:local.db`
 * 폴백이 있어 항상 `true`다(Task 8, `src/lib/server/board.ts`가 프리렌더
 * 가드에 쓴다).
 */
export function hasTursoEnv(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return Boolean(process.env.TURSO_DATABASE_URL?.trim())
}

function createRawClient(): Client {
  assertProductionCredentials()
  const url = process.env.TURSO_DATABASE_URL || 'file:local.db'
  const authToken = process.env.TURSO_AUTH_TOKEN
  return createClient(authToken ? { url, authToken } : { url })
}

let cachedRawClient: Client | null = null
function getRawClient(): Client {
  if (!cachedRawClient) {
    cachedRawClient = createRawClient()
  }
  return cachedRawClient
}

let cachedDb: Db | null = null
function getDb(): Db {
  if (!cachedDb) {
    cachedDb = drizzle(getRawClient(), { schema })
  }
  return cachedDb
}

/**
 * `resolve()`가 만드는 실제 인스턴스를 "실제로 속성에 접근하는 시점"까지
 * 생성을 미루는 Proxy. Better Auth의 `drizzleAdapter(db, { provider: 'sqlite'
 * })`는 `db`를 모듈 로드 시점에 클로저로만 캡처하고, `db._`·`db.query`·
 * `db.insert(...)` 같은 실제 속성 접근/호출은 요청 처리 시점에야 일어난다
 * (node_modules/@better-auth/drizzle-adapter/dist/index.mjs의
 * `createCustomAdapter`, node_modules/@better-auth/core/dist/db/adapter/
 * factory.mjs의 `customAdapter({...})` 호출부에서 확인 — 둘 다 db의 속성을
 * 동기적으로 읽지 않고 나중에 호출될 함수 안에서만 참조한다) — 그래서 이
 * Proxy로 감싸도 `betterAuth({ database: drizzleAdapter(db, ...) })` 배선이
 * 모듈 로드 시점에 깨지지 않는다.
 */
function createLazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const instance = resolve()
      const value = Reflect.get(instance as object, prop, instance)
      return typeof value === 'function' ? value.bind(instance) : value
    },
    has(_target, prop) {
      return Reflect.has(resolve() as object, prop)
    },
  })
}

export const rawClient: Client = createLazyProxy(getRawClient)

export const db: Db = createLazyProxy(getDb)
