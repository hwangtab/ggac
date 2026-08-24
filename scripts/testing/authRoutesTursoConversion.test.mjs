import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * `src/app/api/auth/verify-session/route.ts`·`src/app/auth/callback/route.ts`는
 * Next.js 라우트 핸들러라 `next/headers`(요청 스코프)에 묶인 `readSessionUser()`에
 * 의존한다 — 플레인 `node --test`에서 직접 호출하면 요청 스코프가 없어
 * `headers()`가 항상 실패하고(내부에서 삼켜져 `null`), `requireUser()`/
 * `readSessionUser()`가 곧장 "미인증" 분기로 빠져서 정작 검증하려는 Turso
 * 전환 로직(프로필 조회 성공/행 없음/조회 실패)에는 도달하지 못한다.
 *
 * 그 프로필 조회 로직 자체(`getProfileById`의 null/throw 계약)는
 * `scripts/testing/queriesProfiles.test.mjs`가, 그 계약을 소비하는
 * `resolveSessionProfile`/`checkAdminPermission`/`getDirectorRoster`/
 * `getAuditorRoster`는 `scripts/testing/authzTursoConversion.test.mjs`가 실제
 * SQLite로 검증한다. 이 파일은 두 라우트가 그 계층을 올바르게 호출하고,
 * Supabase `member_profiles` 직접 조회로 되돌아가지 않았고, 실패 시 이전과
 * 같은 방향으로 fail-closed하는지를 소스 패턴으로 고정한다
 * (`scripts/testing/assert-runtime-risks.mjs`의 기존 방식과 동일한 접근).
 */

const verifySessionPath = 'src/app/api/auth/verify-session/route.ts'
const verifySessionSource = readFileSync(verifySessionPath, 'utf8')
const authCallbackPath = 'src/app/auth/callback/route.ts'
const authCallbackSource = readFileSync(authCallbackPath, 'utf8')

test('verify-session: member_profiles를 직접 조회하지 않고 getProfileById로 위임한다', () => {
  assert.doesNotMatch(verifySessionSource, /from\(['"]member_profiles['"]\)/)
  assert.match(verifySessionSource, /from\s+['"]@\/db\/queries\/profiles['"]/)
  assert.match(verifySessionSource, /getProfileById\(user\.id\)/)
})

test('verify-session: 응답 profile 필드 8개가 그대로 보존된다 (프런트가 res.data.profile.xxx를 직접 읽는다)', () => {
  for (const field of [
    'registration_status',
    'is_active',
    'display_name',
    'is_admin',
    'is_artist',
    'artist_id',
    'is_director',
    'is_auditor',
  ]) {
    assert.match(
      verifySessionSource,
      new RegExp(`${field}:\\s*profile\\.${field}`),
      `${field}가 응답에서 빠졌다`
    )
  }
})

test('verify-session: 프로필 조회 실패(throw)를 삼켜 profile: null(200)로 응답한다 — 500으로 승격하지 않는다', () => {
  const getHandlerMatch = verifySessionSource.match(/export async function GET\(\)[\s\S]*/)
  assert.ok(getHandlerMatch, 'GET 핸들러를 찾지 못했다')
  const body = getHandlerMatch[0]
  assert.match(body, /try\s*\{\s*\n\s*profile = await getProfileById\(user\.id\)/)
  assert.match(body, /catch\s*\(error\)\s*\{/)
  // 바깥쪽(라우트 전체) try/catch가 이 실패를 삼켜 500으로 승격시키지 않는지
  // 확인 — getProfileById 실패는 안쪽 try/catch에서 잡혀야 하고, 그 결과
  // ApiSuccess.ok(...profile: null)로 응답해야 한다(기존 동작 보존).
  assert.match(body, /profileLookupFailed \|\| !profile/)
  assert.match(body, /ApiSuccess\.ok\(\{[\s\S]*?profile:\s*null/)
})

test('auth/callback: member_profiles를 직접 조회하지 않고 getProfileById로 위임한다', () => {
  assert.doesNotMatch(authCallbackSource, /from\(['"]member_profiles['"]\)/)
  assert.match(authCallbackSource, /from\s+['"]@\/db\/queries\/profiles['"]/)
  assert.match(authCallbackSource, /getProfileById\(user\.id\)/)
})

test('auth/callback: createSupabaseServer는 여전히 남아있다 (RPC 로깅에 계속 쓴다 — member_profiles만 옮겼다)', () => {
  assert.match(authCallbackSource, /from\s+['"]@\/lib\/supabase\/server['"]/)
  assert.match(authCallbackSource, /createSupabaseServer/)
  assert.match(authCallbackSource, /supabase\.rpc\(['"]manage_user_session['"]/)
  assert.match(authCallbackSource, /supabase\.rpc\(['"]log_user_activity['"]/)
})

test('auth/callback: 프로필 조회 실패(throw)를 삼켜 /register/pending으로 보낸다 — 행 없음과 같은 목적지(이전 Supabase .single()과 동일한 결과)', () => {
  const src = authCallbackSource
  assert.match(src, /try\s*\{\s*\n\s*profile = await getProfileById\(user\.id\)/)
  assert.match(src, /catch\s*\(profileLookupError\)\s*\{/)
  // catch 블록 안에 별도 redirect가 없다 — 그냥 profile: null로 남겨 아래
  // 공통 `if (!profile)` 분기(/register/pending)로 흘러야 한다.
  const tryCatchMatch = src.match(
    /try\s*\{\s*\n\s*profile = await getProfileById\(user\.id\)[\s\S]*?\n\s{6}\}\n/
  )
  assert.ok(tryCatchMatch, 'try/catch 블록을 찾지 못했다')
  assert.doesNotMatch(
    tryCatchMatch[0],
    /redirectToPath/,
    'catch 블록이 자체적으로 리다이렉트하면 안 된다 — 공통 !profile 분기로 흘러야 한다'
  )
  assert.match(
    src,
    /if \(!profile\) \{[\s\S]*?redirectToPath\(requestUrl,\s*['"]\/register\/pending['"],\s*locale\)/
  )
})

test('auth/callback: registration_status 세 분기(pending/approved+active/그 외)가 그대로 유지된다', () => {
  assert.match(authCallbackSource, /profile\.registration_status === ['"]pending['"]/)
  assert.match(
    authCallbackSource,
    /profile\.registration_status === ['"]approved['"] && profile\.is_active/
  )
  assert.match(authCallbackSource, /redirectToPath\(requestUrl,\s*['"]\/board['"],\s*locale\)/)
  assert.match(
    authCallbackSource,
    /redirectToPath\(requestUrl,\s*['"]\/register\/rejected['"],\s*locale\)/
  )
})
