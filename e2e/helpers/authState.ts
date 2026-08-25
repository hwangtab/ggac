import { readFileSync } from 'node:fs'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export type Fixtures = {
  users: Record<'admin' | 'owner' | 'other' | 'pending', string>
  postId: string
  commentId: string
  notificationId: string
}

/**
 * 권한 E2E는 글을 쓰고 지운다. playwright.config.ts의 webServer는 `npm run dev`를
 * 띄우고 Next.js는 `.env.local`을 읽는데, 그 파일은 **운영 Supabase**를 가리킨다.
 * 환경변수 주입이 빠진 채로 이 스펙이 돌면 운영 게시판에 테스트 글이 쌓인다.
 * 그래서 스펙 파일마다 맨 위에서 이 가드를 부른다 — 설정 실수를 테스트가
 * 스스로 막는다.
 */
export function assertLocalSupabase(): void {
  const url = process.env.E2E_SUPABASE_URL
  if (!url) {
    throw new Error('E2E_SUPABASE_URL이 없다. 권한 E2E는 로컬 스택에서만 돌린다.')
  }
  const { hostname } = new URL(url)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`권한 E2E를 로컬이 아닌 대상에 돌리지 않는다: ${hostname}`)
  }
}

/**
 * member_profiles·posts·comments·notifications·post_likes가 단계 2c에서
 * Turso 권위로 넘어간 뒤, 스펙이 그 테이블을 직접 리셋하려면(예:
 * authz-remaining.spec.ts의 resetNotificationUnread) Turso에도 같은 보호가
 * 필요해졌다 — `assertLocalSupabase()`와 같은 원칙(운영이면 즉시 거부)을
 * `scripts/testing/seed-authz-fixtures.mjs`의 `requireLocalEnv()`가 쓰는
 * 판정(`libsql://`로 시작하면 운영)과 동일하게 적용한다. 이 함수를 호출하는
 * 스펙 파일은 `process.env.TURSO_DATABASE_URL`을 직접 읽어 로컬 파일 DB에
 * 쓴다는 뜻이다 — playwright.config.ts의 webServer(Next.js 앱 프로세스)에는
 * `E2E_TURSO_DATABASE_URL`이 `TURSO_DATABASE_URL`로 전달되지만, 이 판정은
 * 스펙 파일 자신의 프로세스 환경(`TURSO_DATABASE_URL`을 직접 export)을 본다
 * — 두 값이 어긋나면 로컬 실행 안내에서 반드시 같은 값으로 맞추라고 적어야
 * 한다.
 */
export function assertLocalTurso(): void {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error('TURSO_DATABASE_URL이 없다. 권한 E2E는 로컬 파일 DB에서만 돌린다.')
  }
  if (url.startsWith('libsql://')) {
    throw new Error(`권한 E2E를 운영으로 보이는 TURSO_DATABASE_URL에 돌리지 않는다: ${url}`)
  }
}

export function storageStatePath(role: string): string {
  return `e2e/.auth/${role}.json`
}

export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync('e2e/.authz-fixtures.json', 'utf8'))
}
