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
  'RESEND_API_KEY',
  'RESEND_INBOUND_API_KEY',
  'RESEND_INBOUND_WEBHOOK_SECRET',
  'MAILBOX_ALLOWED_RECIPIENTS',
  'CRON_SECRET',
  // 결제 변수도 지운다. 남겨 두면 개발자 환경의 실제 키가 조건부 분기를 타서
  // 아래 결제 대조가 대조가 되지 않는다.
  'NEXT_PUBLIC_PAYMENT_MODE',
  'NEXT_PUBLIC_TOSS_CLIENT_KEY',
  'TOSS_SECRET_KEY',
  'NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY',
  'TOSS_BILLING_SECRET_KEY',
]

const COMPLETE_ENV = {
  TURSO_DATABASE_URL: 'file:local.db',
  TURSO_AUTH_TOKEN: 'local-placeholder',
  BETTER_AUTH_SECRET: 'local-placeholder',
  NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: 'https://example-store.public.blob.vercel-storage.com',
  PUBLIC_BLOB_READ_WRITE_TOKEN: 'local-placeholder',
  PRIVATE_BLOB_READ_WRITE_TOKEN: 'local-placeholder',
  RESEND_API_KEY: 'local-placeholder',
  RESEND_INBOUND_API_KEY: 'local-placeholder',
  RESEND_INBOUND_WEBHOOK_SECRET: 'local-placeholder',
  MAILBOX_ALLOWED_RECIPIENTS: 'office@ggac.kr',
  CRON_SECRET: 'local-placeholder',
}

/** 결제를 켠 상태의 최소 구성. 접두사만 의미가 있고 값은 아무래도 좋다. */
const PAYMENT_ENV = {
  NEXT_PUBLIC_PAYMENT_MODE: 'toss',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_sample',
  TOSS_SECRET_KEY: 'test_gsk_sample',
  NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY: 'test_ck_sample',
  TOSS_BILLING_SECRET_KEY: 'test_sk_sample',
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
  'RESEND_API_KEY',
  'RESEND_INBOUND_API_KEY',
  'RESEND_INBOUND_WEBHOOK_SECRET',
  'MAILBOX_ALLOWED_RECIPIENTS',
  // Vercel 크론이 실제로 보내는 값. 없으면 vercel.json의 크론 셋이 전부 401만
  // 받고, funding/expire는 대체 토큰조차 없어 만료·환불이 통째로 멈춘다.
  'CRON_SECRET',
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

test('죽은 Supabase 키(url/anon/service-role)가 없어도 통과한다 — 컷오버에서 지울 수 있어야 한다', () => {
  const { code, stdout } = run(COMPLETE_ENV)
  assert.equal(code, 0, stdout)
  assert.match(stdout, /NEXT_PUBLIC_SUPABASE_URL: Not set \(optional\)/)
  assert.match(stdout, /NEXT_PUBLIC_SUPABASE_ANON_KEY: Not set \(optional\)/)
  assert.match(stdout, /SUPABASE_SERVICE_ROLE_KEY: Not set \(optional\)/)
})

// 2026-09-01 Supabase 프로젝트 삭제로 전제가 사라졌다. 이 값을 읽던 레거시
// Storage URL 판정 4곳이 없어졌으므로, Vercel에서 지워도 배포 전 점검이
// 빨간불이 되면 안 된다.
test('NEXT_PUBLIC_SUPABASE_URL은 더 이상 필수가 아니다', () => {
  const env = { ...COMPLETE_ENV }
  delete env.NEXT_PUBLIC_SUPABASE_URL
  const { code, stdout } = run(env)
  assert.equal(code, 0, stdout)
  assert.doesNotMatch(stdout, /NEXT_PUBLIC_SUPABASE_URL: Missing/)
})

// 결제 키는 킬스위치(NEXT_PUBLIC_PAYMENT_MODE)가 켜져 있을 때만 필수다.
// 양방향을 다 못박는다 — 꺼 놓은 배포를 막아서도 안 되고, 켜 놓고 키가
// 없거나 어긋난 상태를 초록불로 넘겨서도 안 된다(승인 단계에서 통째로 실패).
test('결제를 켜지 않았으면 토스 키가 없어도 통과한다', () => {
  const { code, stdout } = run(COMPLETE_ENV)
  assert.equal(code, 0, stdout)
  assert.match(stdout, /NEXT_PUBLIC_PAYMENT_MODE: Not set \(optional\)/)
  assert.match(stdout, /NEXT_PUBLIC_TOSS_CLIENT_KEY: Not set \(optional\)/)
  assert.match(stdout, /TOSS_SECRET_KEY: Not set \(optional\)/)
  assert.doesNotMatch(stdout, /NEXT_PUBLIC_TOSS_CLIENT_KEY: Missing/)
})

test('결제 키 쌍이 갖춰져 있으면 통과한다', () => {
  const { code, stdout } = run({ ...COMPLETE_ENV, ...PAYMENT_ENV })
  assert.equal(code, 0, stdout)
  assert.doesNotMatch(stdout, /자동결제/)
})

for (const key of ['NEXT_PUBLIC_TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY']) {
  test(`부정 대조: 결제를 켰는데 ${key}가 없으면 실패한다`, () => {
    const env = { ...COMPLETE_ENV, ...PAYMENT_ENV }
    delete env[key]
    const { code, stdout } = run(env)
    assert.equal(code, 1, `${key} 없이 통과하면 안 된다:\n${stdout}`)
    assert.match(stdout, new RegExp(`${key}: Missing`))
  })
}

test('부정 대조: 결제 키의 test/live가 어긋나면 실패한다', () => {
  const { code, stdout } = run({
    ...COMPLETE_ENV,
    ...PAYMENT_ENV,
    TOSS_SECRET_KEY: 'live_gsk_sample',
  })
  assert.equal(code, 1, stdout)
  assert.match(stdout, /토스 결제 키의 환경이 어긋납니다/)
})

test('부정 대조: 결제 키 형식이 test_·live_가 아니면 실패한다', () => {
  const { code, stdout } = run({
    ...COMPLETE_ENV,
    ...PAYMENT_ENV,
    TOSS_SECRET_KEY: 'gsk_sample',
  })
  assert.equal(code, 1, stdout)
  assert.match(stdout, /TOSS_SECRET_KEY: Invalid format/)
})

test('자동결제 키가 없거나 계열이 틀리면 경고만 하고 통과한다', () => {
  const missing = { ...COMPLETE_ENV, ...PAYMENT_ENV }
  delete missing.TOSS_BILLING_SECRET_KEY
  const first = run(missing)
  assert.equal(first.code, 0, first.stdout)
  assert.match(first.stdout, /자동결제 키.*없어/)

  const wrongFamily = run({
    ...COMPLETE_ENV,
    ...PAYMENT_ENV,
    NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY: 'test_gck_sample',
    TOSS_BILLING_SECRET_KEY: 'test_gsk_sample',
  })
  assert.equal(wrongFamily.code, 0, wrongFamily.stdout)
  assert.match(wrongFamily.stdout, /자동결제 키가 일반결제 계열/)
})
