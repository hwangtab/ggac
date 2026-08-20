import { test } from 'node:test'
import assert from 'node:assert/strict'

const { resolveEmailLinkBaseUrl } = await import('../../src/lib/auth/emailBaseUrl.ts')

/**
 * 각 테스트 전후로 두 환경변수를 저장·복원한다 — 이 프로세스의 다른 테스트
 * 파일이나 실제 `.env.local` 값에 영향을 주거나 받지 않기 위해서다.
 */
function withEnv(vars, fn) {
  const keys = ['NEXT_PUBLIC_SITE_URL', 'BETTER_AUTH_URL']
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  try {
    for (const key of keys) {
      if (key in vars) {
        process.env[key] = vars[key]
      } else {
        delete process.env[key]
      }
    }
    return fn()
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

test('NEXT_PUBLIC_SITE_URL만 설정되면 그 값을 절대 URL로 돌려준다', () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://ggac.kr' }, () => {
    const base = resolveEmailLinkBaseUrl()
    assert.equal(base, 'https://ggac.kr')
    assert.match(base, /^https?:\/\//, '절대 URL(스킴 포함)이어야 한다')
  })
})

test('BETTER_AUTH_URL만 설정돼도 그 값을 절대 URL로 돌려준다', () => {
  withEnv({ BETTER_AUTH_URL: 'https://staging.ggac.kr' }, () => {
    const base = resolveEmailLinkBaseUrl()
    assert.equal(base, 'https://staging.ggac.kr')
    assert.match(base, /^https?:\/\//, '절대 URL(스킴 포함)이어야 한다')
  })
})

test('둘 다 설정되면 NEXT_PUBLIC_SITE_URL을 우선한다', () => {
  withEnv(
    { NEXT_PUBLIC_SITE_URL: 'https://ggac.kr', BETTER_AUTH_URL: 'https://internal.ggac.kr' },
    () => {
      assert.equal(resolveEmailLinkBaseUrl(), 'https://ggac.kr')
    }
  )
})

test('둘 다 없으면 던진다 (빈 문자열로 폴백하지 않는다)', () => {
  withEnv({}, () => {
    assert.throws(() => resolveEmailLinkBaseUrl(), /NEXT_PUBLIC_SITE_URL.*BETTER_AUTH_URL/)
  })
})
