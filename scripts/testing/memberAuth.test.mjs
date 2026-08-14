import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// memberAuth.ts는 adminAuth.ts/boardRoomAuth.ts와 같은 형태를 따르기 위해
// `@/lib/server/authz` 같은 tsconfig 경로 별칭과 `next/server`·`next/headers`를
// 정적 import한다. 둘 다 플레인 `node --test`의 ESM 리졸버가 기본으로는 풀지
// 못한다 — `@/*`는 번들러 전용 별칭이고, `next/server`처럼 `exports` 필드가
// 없는 패키지의 확장자 없는 서브패스는 Node ESM이 자동으로 `.js`를 붙여주지
// 않는다(CJS `require`와 달리). 이 프로젝트의 기존 `*.test.mjs`들은 이런
// 프레임워크 의존 모듈을 아예 피해서 이 문제를 만난 적이 없었다.
// 여기서만 쓰는 리졸브 훅으로 두 가지만 보정한다: `@/` 접두어를 `src/`로
// 매핑, 그리고 확장자 없는 리졸브 실패 시 `.js`를 한 번 더 시도. `node --test`는
// 파일마다 별도 프로세스로 격리해 실행하므로(기본 동작) 이 훅은 다른
// 테스트 파일에 영향을 주지 않는다.
const projectRootUrl = new URL('../../', import.meta.url).href
const resolveHookSource = `
const ROOT = ${JSON.stringify(projectRootUrl)}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL('src/' + specifier.slice(2) + '.ts', ROOT).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isBareSpecifier = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && !specifier.endsWith('.js') && isBareSpecifier) {
      return await nextResolve(specifier + '.js', context)
    }
    throw err
  }
}
`
register('data:text/javascript,' + encodeURIComponent(resolveHookSource), import.meta.url)

const { classifySessionForUser, classifySessionForMember } = await import(
  '../../src/lib/server/memberAuth.ts'
)

// 이 두 함수는 세션 컨텍스트를 받아 "어떤 응답을 내야 하는가"만 판정하는 순수
// 함수다. NextResponse 조립이나 service-role 클라이언트 생성 같은 부수효과가
// 없으므로 단위 테스트로 분기를 전수 고정할 수 있다.

test('requireUser 판정: 인증되면 ok', () => {
  assert.equal(
    classifySessionForUser({ authenticated: true, user: { id: 'u1' }, profile: null }),
    'ok'
  )
})

test('requireUser 판정: 프로필이 없어도 ok — 승인 대기자도 통과해야 한다', () => {
  // classifySessionForUser는 profile/profileError를 아예 보지 않는다. 프로필
  // 조회가 실패한 경우(profile: null + profileError 존재 — handle_new_user
  // 트리거가 INSERT 실패를 삼켜서 실제로 발생할 수 있는 상태, 최종 리뷰 확인)
  // 까지 입력에 넣어야 "이름이 약속하는 검증"이 성립한다. 바로 앞 테스트와
  // 입력이 같으면 이 테스트가 실제로는 아무것도 추가로 증명하지 못한다.
  assert.equal(
    classifySessionForUser({
      authenticated: true,
      user: { id: 'u1' },
      profile: null,
      profileError: { message: 'profile lookup failed' },
    }),
    'ok'
  )
})

test('requireUser 판정: 미인증이면 unauthenticated', () => {
  assert.equal(
    classifySessionForUser({ authenticated: false, user: null, profile: null }),
    'unauthenticated'
  )
  assert.equal(
    classifySessionForUser({ authenticated: true, user: null, profile: null }),
    'unauthenticated'
  )
})

test('requireActiveMember 판정: 승인+활성이면 ok', () => {
  assert.equal(
    classifySessionForMember({
      authenticated: true,
      user: { id: 'u1' },
      profile: { registration_status: 'approved', is_active: true },
    }),
    'ok'
  )
})

test('requireActiveMember 판정: 미인증이면 unauthenticated', () => {
  assert.equal(
    classifySessionForMember({ authenticated: false, user: null, profile: null }),
    'unauthenticated'
  )
  // classifySessionForUser 쪽 테스트(위)는 authenticated:true + user:null인
  // 모순 상태까지 덮지만, 이 테스트는 그동안 authenticated:false만 덮고 있었다
  // — `if (!session.authenticated || !session.user)`의 두 조건 중 뒤쪽
  // 분기가 실제로 unauthenticated로 이어지는지 이 테스트만으로는 증명하지
  // 못했다.
  assert.equal(
    classifySessionForMember({ authenticated: true, user: null, profile: null }),
    'unauthenticated'
  )
})

test('requireActiveMember 판정: 프로필 조회 실패면 profile-error', () => {
  assert.equal(
    classifySessionForMember({
      authenticated: true,
      user: { id: 'u1' },
      profile: null,
      profileError: { message: 'boom' },
    }),
    'profile-error'
  )
  assert.equal(
    classifySessionForMember({ authenticated: true, user: { id: 'u1' }, profile: null }),
    'profile-error'
  )
})

test('requireActiveMember 판정: 미승인·비활성은 not-approved', () => {
  const cases = [
    { registration_status: 'pending', is_active: true },
    { registration_status: 'rejected', is_active: true },
    { registration_status: 'approved', is_active: false },
    { registration_status: 'pending', is_active: false },
  ]
  for (const profile of cases) {
    assert.equal(
      classifySessionForMember({ authenticated: true, user: { id: 'u1' }, profile }),
      'not-approved',
      JSON.stringify(profile)
    )
  }
})

test('requireActiveMember 판정: 관리자여도 미승인이면 통과하지 못한다', () => {
  assert.equal(
    classifySessionForMember({
      authenticated: true,
      user: { id: 'u1' },
      profile: { registration_status: 'pending', is_active: true, is_admin: true },
    }),
    'not-approved'
  )
})
