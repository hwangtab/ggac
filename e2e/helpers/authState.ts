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

export function storageStatePath(role: string): string {
  return `e2e/.auth/${role}.json`
}

export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync('e2e/.authz-fixtures.json', 'utf8'))
}
