import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// fundingAuth.ts는 `@/lib/server/authz` 같은 tsconfig 경로 별칭을 정적
// import한다. 플레인 `node --test`의 ESM 리졸버는 번들러 전용 별칭인 `@/*`를
// 풀지 못하므로, memberAuth.test.mjs와 같은 해석 훅을 여기서도 등록한다.
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

const { canManageCampaign, canReviewCampaign, canViewPledge } = await import(
  '../../src/lib/server/fundingAuth.ts'
)

const member = { registration_status: 'approved', is_active: true, is_admin: false }
const admin = { ...member, is_admin: true }
const pending = { registration_status: 'pending', is_active: false, is_admin: false }
const campaign = { owner_user_id: 'owner' }

test('소유자이면서 승인·활성이어야 관리한다', () => {
  assert.equal(canManageCampaign(member, 'owner', campaign), true)
  assert.equal(canManageCampaign(member, 'other', campaign), false)
  assert.equal(canManageCampaign(pending, 'owner', campaign), false)
  assert.equal(canManageCampaign(null, 'owner', campaign), false)
})

test('관리자는 소유자가 아니어도 관리하고, 심사는 관리자만', () => {
  assert.equal(canManageCampaign(admin, 'other', campaign), true)
  assert.equal(canReviewCampaign(admin), true)
  assert.equal(canReviewCampaign(member), false)
})

test('후원 열람은 본인만(비회원 후원은 세션으로 못 본다)', () => {
  assert.equal(canViewPledge('u1', { user_id: 'u1' }), true)
  assert.equal(canViewPledge('u1', { user_id: 'u2' }), false)
  assert.equal(canViewPledge('u1', { user_id: null }), false)
  assert.equal(canViewPledge(null, { user_id: null }), false)
})
