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
  // getProfileById 호출을 감싸는 "안쪽" try/catch 자체를 하나의 블록으로
  // 붙잡는다 — 단순히 `catch (error) {`만 찾으면 라우트 바깥쪽(전체) catch
  // (`} catch (error) { ... internalServerError ... }`, 71행)에도 매치돼서
  // 안쪽 catch가 통째로 사라져도 아무것도 못 잡는다(리뷰 라운드 1 Minor 1
  // 지적). 이 블록 매칭은 try 시작부터 그 catch의 닫는 중괄호까지를 통째로
  // 요구하므로, 안쪽 catch가 사라지면(= getProfileById가 감싸이지 않은 채
  // 그대로 호출되면) 매치 자체가 실패한다.
  const profileLookupBlock = body.match(
    /try \{\s*\n\s*profile = await getProfileById\(user\.id\)\s*\n\s*\} catch \(error\) \{[\s\S]*?\n\s{4}\}\n/
  )
  assert.ok(
    profileLookupBlock,
    'getProfileById(user.id)를 감싸는 try { ... } catch (error) { ... } 블록을 찾지 못했다'
  )
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

test('auth/callback: 단계 4 이후 createSupabaseServer/RPC를 쓰지 않는다 — manage_user_session/log_user_activity가 Turso 쿼리 계층으로 넘어갔다', () => {
  assert.doesNotMatch(authCallbackSource, /createSupabaseServer/)
  assert.doesNotMatch(authCallbackSource, /from\s+['"]@\/lib\/supabase\/server['"]/)
  assert.doesNotMatch(authCallbackSource, /supabase\.rpc\(/)
  assert.match(authCallbackSource, /from\s+['"]@\/db\/queries\/sessions['"]/)
  assert.match(authCallbackSource, /from\s+['"]@\/db\/queries\/activities['"]/)
  assert.match(authCallbackSource, /manageUserSession\(/)
  assert.match(authCallbackSource, /logUserActivity\(/)
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

test('auth/callback: registration_status 세 분기가 각각 정확한 목적지와 짝지어져 있다(분기↔목적지 순서 고정)', () => {
  // 토큰이 파일 어딘가에 각자 있는지만 보면(예: pending 존재 + /board 존재)
  // "pending을 /board로 잘못 잇는" 가장 위험한 회귀(승인 대기 회원이
  // 게시판에 들어감)를 놓친다(리뷰 라운드 1 Minor 2 지적). 아래는 조건문의
  // 여는 중괄호부터 그 조건이 실제로 리턴하는 redirectToPath까지를 한
  // 블록으로 묶어 짝을 고정하고, 세 분기가 정확히 이 순서(pending →
  // approved+active → 그 외)로 이어지는지까지 하나의 정규식으로 검사한다.
  const branchChain = authCallbackSource.match(
    /if \(profile\.registration_status === ['"]pending['"]\) \{[\s\S]*?redirectToPath\(requestUrl,\s*['"]\/register\/pending['"],\s*locale\)\s*\n\s*\}\s*\n\s*\n\s*if \(profile\.registration_status === ['"]approved['"] && profile\.is_active\) \{[\s\S]*?redirectToPath\(requestUrl,\s*['"]\/board['"],\s*locale\)\s*\n\s*\}\s*\n[\s\S]*?redirectToPath\(requestUrl,\s*['"]\/register\/rejected['"],\s*locale\)/
  )
  assert.ok(
    branchChain,
    'registration_status 분기와 목적지가 짝을 이루지 않는다 — pending→/register/pending, ' +
      'approved+active→/board, 그 외→/register/rejected 순서와 짝을 확인하라'
  )
})
