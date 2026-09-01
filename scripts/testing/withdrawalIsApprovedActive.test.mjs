import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { register } from 'node:module'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 음성 통제(voice control) — 이번 수정의 핵심 검증.
 *
 * "신청 중에도 아무것도 바뀌지 않는다"는 설계 약속을, 상태값 비교가 아니라
 * **실제 인가 함수 `isApprovedActive`를 그대로 불러 호출**해서 못박는다.
 * 상태 목록 검사나 SQL로 재현한 로직은 `isApprovedActive`의 정의가 나중에
 * 바뀌어도 따라 바뀌지 않아 드리프트가 생긴다 — 그래서 여기서는 진짜 함수를
 * import한다.
 *
 * `src/lib/server/authz.ts` → `@/lib/server/session`(next/headers) →
 * `@/lib/auth/server` 체인은 `node --test`의 네이티브 ESM 리졸버가 풀지
 * 못하는 `@/*` 별칭과 확장자 생략 상대경로를 문다.
 * `scripts/testing/memberAuth.test.mjs`가 이미 쓰는 리졸브 훅을 그대로
 * 재사용한다 — 새 방식을 발명하지 않는다.
 */
const projectRootUrl = new URL('../../', import.meta.url).href
const resolveHookSource = `
const ROOT = ${JSON.stringify(projectRootUrl)}
const FALLBACK_SUFFIXES = ['.ts', '.js', '/index.ts']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL('src/' + specifier.slice(2) + '.ts', ROOT).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isResolutionError =
      err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (isResolutionError && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      for (const suffix of FALLBACK_SUFFIXES) {
        try {
          return await nextResolve(specifier + suffix, context)
        } catch {
          // 다음 후보 확장자로 계속 시도한다.
        }
      }
    }
    throw err
  }
}
`
register('data:text/javascript,' + encodeURIComponent(resolveHookSource), import.meta.url)

// `src/db/client.ts`의 지연 Proxy가 처음 접근 시점의 env로 연결을 고정한다 —
// 모듈을 처음 import하기 전에 파일 스코프에서 직접 설정해야 한다
// (`withdrawal.test.mjs`와 같은 패턴, 운영 DB 오발사 방지).
const DB_PATH = 'scripts/testing/.withdrawal-isapprovedactive-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const { isApprovedActive } = await import('@/lib/server/authz')
const { getProfileById } = await import('../../src/db/queries/profiles.ts')
const { requestWithdrawal, cancelWithdrawal } = await import('../../src/db/queries/withdrawal.ts')

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('탈퇴를 신청해도 isApprovedActive는 계속 참이다(핵심 회귀 방지)', async () => {
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, registration_status, is_active, is_admin, created_at, updated_at)
          VALUES ('voice1', 'voice1@example.test', '회원 voice1', 'approved', 1, 0, ?, ?)`,
    args: [now, now],
  })

  const before = await getProfileById('voice1')
  assert.equal(isApprovedActive(before), true, '신청 전에는 당연히 승인·활성이어야 한다')

  assert.equal(await requestWithdrawal('voice1'), true)

  const afterRequest = await getProfileById('voice1')
  // 이것이 이번 수정이 고치는 결함의 정중앙이다: 신청 상태를
  // `registration_status`로 표현했다면 여기서 거짓이 되어, 취소 API
  // (`requireActiveMember` → `isApprovedActive`)가 항상 403을 내는
  // "신청하면 취소할 방법이 없다" 결함으로 되돌아간다.
  assert.equal(
    isApprovedActive(afterRequest),
    true,
    '탈퇴 신청 중에도 승인·활성 조합원이어야 한다 — 그래야 취소 API를 부를 수 있다'
  )
  assert.equal(afterRequest?.registration_status, 'approved')
  assert.notEqual(afterRequest?.withdrawal_requested_at, null)

  assert.equal(await cancelWithdrawal('voice1'), true)
  const afterCancel = await getProfileById('voice1')
  assert.equal(isApprovedActive(afterCancel), true)
  assert.equal(afterCancel?.withdrawal_requested_at, null)
})
