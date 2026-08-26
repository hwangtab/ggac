import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * 최종 리뷰 B-2 — `scripts/verify-env.js`.
 *
 * 두 방향을 다 못박는다.
 *  ① Blob 변수가 비면 **빨간불이어야 한다.** 예전에는 셋 다 없어도 초록불이었고,
 *    그 상태의 배포는 에러 없이 화면만 망가진다(아티스트 사진이 전부 기본
 *    로고로 바뀌고 첨부 렌더 게이트가 닫힌다).
 *  ② 죽은 Supabase 변수(anon/service-role)가 없어도 **초록불이어야 한다.**
 *    필수로 두면 컷오버에서 그 키를 지우는 순간 배포 전 점검이 거짓으로
 *    빨간불이 되고, 운영자에게 쓰지도 않는 service-role 키를 계속 꽂아 두라고
 *    압박한다.
 */

const SCRIPT = path.resolve('scripts/verify-env.js')

// `@next/env`의 loadEnvConfig가 `.env*`를 **cwd 기준으로** 읽어 들인다.
//
// 검사 대상 변수를 지우는 것만으로는 부족하다 — 지우면 그 자리를 개발자의
// `.env.local`이 채워서 **음성 대조가 대조가 되지 않는다.** (워크트리에는
// `.env.local`이 없어 통과하지만 메인 저장소에서는 5건이 실패했다.)
//
// 그래서 `.env*`가 없는 임시 디렉터리를 cwd로 주고 스크립트는 절대 경로로
// 부른다. 그러면 loadEnvConfig가 아무것도 못 찾아 이 파일이 넘긴 환경만 남는다.
// (스크립트가 cwd를 쓰는 다른 자리는 `vercel env pull` 분기뿐이고 이 파일은
// 그 경로를 밟지 않는다.)
const ALL_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'BETTER_AUTH_SECRET',
  'NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL',
  'PUBLIC_BLOB_READ_WRITE_TOKEN',
  'PRIVATE_BLOB_READ_WRITE_TOKEN',
]

const COMPLETE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
  TURSO_DATABASE_URL: 'file:local.db',
  TURSO_AUTH_TOKEN: 'local-placeholder',
  BETTER_AUTH_SECRET: 'local-placeholder',
  NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: 'https://example-store.public.blob.vercel-storage.com',
  PUBLIC_BLOB_READ_WRITE_TOKEN: 'local-placeholder',
  PRIVATE_BLOB_READ_WRITE_TOKEN: 'local-placeholder',
}

function run(overrides) {
  const env = { ...process.env }
  for (const key of ALL_KEYS) delete env[key]
  // 운영 전용 분기(Redis·CSP)는 이 파일의 관심사가 아니다 — development로 돌린다.
  delete env.NODE_ENV
  Object.assign(env, overrides)

  const isolatedCwd = mkdtempSync(path.join(tmpdir(), 'ggac-verify-env-'))
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      env,
      stdio: 'pipe',
      cwd: isolatedCwd,
    })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? '') }
  } finally {
    rmSync(isolatedCwd, { recursive: true, force: true })
  }
}

test('Blob 변수 셋을 포함해 전부 있으면 통과한다', () => {
  const { code, stdout } = run(COMPLETE_ENV)
  assert.equal(code, 0, stdout)
  assert.match(stdout, /Environment verification passed/)
})

for (const key of [
  'NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL',
  'PUBLIC_BLOB_READ_WRITE_TOKEN',
  'PRIVATE_BLOB_READ_WRITE_TOKEN',
]) {
  test(`부정 대조: ${key}가 없으면 실패한다`, () => {
    const env = { ...COMPLETE_ENV }
    delete env[key]
    const { code, stdout } = run(env)
    assert.equal(code, 1, `${key} 없이 통과하면 안 된다:\n${stdout}`)
    assert.match(stdout, new RegExp(`${key}: Missing`))
  })
}

test('NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL이 URL이 아니면 실패한다(조용히 false가 되는 값)', () => {
  const { code, stdout } = run({
    ...COMPLETE_ENV,
    NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: 'example-store.public.blob.vercel-storage.com',
  })
  assert.equal(code, 1, stdout)
  assert.match(stdout, /NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: Invalid format/)
})

test('죽은 Supabase 키(anon/service-role)가 없어도 통과한다 — 컷오버에서 지울 수 있어야 한다', () => {
  const { code, stdout } = run(COMPLETE_ENV)
  assert.equal(code, 0, stdout)
  assert.match(stdout, /NEXT_PUBLIC_SUPABASE_ANON_KEY: Not set \(optional\)/)
  assert.match(stdout, /SUPABASE_SERVICE_ROLE_KEY: Not set \(optional\)/)
})

test('NEXT_PUBLIC_SUPABASE_URL은 여전히 필수다(레거시 Storage URL 판정 4곳)', () => {
  const env = { ...COMPLETE_ENV }
  delete env.NEXT_PUBLIC_SUPABASE_URL
  const { code, stdout } = run(env)
  assert.equal(code, 1, stdout)
  assert.match(stdout, /NEXT_PUBLIC_SUPABASE_URL: Missing/)
})
