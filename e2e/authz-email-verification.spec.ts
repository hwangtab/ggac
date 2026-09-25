import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso } from './helpers/authState'

assertLocalTurso()

/**
 * 이메일 인증 관문이 **실제 로그인 요청을 막는지** 증명한다.
 *
 * 판정 자체(설정 읽기·관리자 예외·fail-open)는
 * `scripts/testing/emailVerificationGate.test.mjs`가 실제 SQLite로 본다. 여기서
 * 확인하는 것은 그 판정이 **라우트에 실제로 걸려 있는가**다 — 스위치가 저장은
 * 되는데 아무 일도 일어나지 않던 것이 이 화면의 지병이었다.
 *
 * 관문 자리는 `POST /api/auth/sign-in/email`이라 로그인 화면을 거치지 않고
 * 직접 때린다. 화면의 자체 판정에 가려지지 않은 서버의 답을 보기 위해서다.
 *
 * 설정 캐시: E2E webServer는 `SETTINGS_CACHE_TTL_MS=0`으로 뜬다
 * (`playwright.config.ts`) — 여기서 켠 값이 다음 요청에 바로 보인다.
 *
 * 레이트리밋: 로그인은 **IP 기준 분당 10회**이고 넘기면 15분 차단이다
 * (`AUTH_API`). `authz.setup.ts`가 이미 여섯 번 로그인하므로, 여기서 같은
 * 버킷을 쓰면 뒤쪽 스펙이 429를 받는다 — 그것도 다음 실행까지 남는 차단으로.
 * 그래서 테스트마다 다른 `X-Forwarded-For`를 붙여 버킷을 나눈다(키 생성기가
 * 그 헤더를 본다 — `createDistributedIPKeyGenerator`).
 */

/** 테스트마다 다른 대역(TEST-NET-3, RFC 5737)을 준다 — 서로의 한도를 쓰지 않는다. */
function fromIp(n: number) {
  return { 'X-Forwarded-For': `203.0.113.${n}` }
}

const UNVERIFIED = { email: 'authz-unverified@test.local', password: 'Authz!Unverified2026' }
const VERIFIED = { email: 'authz-other@test.local', password: 'Authz!Other2026' }
const ADMIN = { email: 'authz-admin@test.local', password: 'Authz!Admin2026' }

/**
 * 관문을 켜고 끈다. **영향 행 수를 확인한다** — 시드가 행을 만들지 않으면
 * UPDATE는 0행에 적용되고 아무 에러도 나지 않으며, 그 상태에서도 "막히지
 * 않는다" 계열 단정은 그대로 통과한다.
 */
async function setGate(enforced: boolean) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
            WHERE category = 'security' AND setting_key = 'email_verification'`,
      args: [
        JSON.stringify({
          enforce_on_login: enforced,
          required: enforced,
          token_expiry_hours: 24,
          resend_limit: 3,
        }),
        Date.now(),
      ],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `이메일 인증 설정 실패: system_settings(security/email_verification) 행이 ${res.rowsAffected}개 갱신됐다. ` +
          '픽스처 시드(scripts/testing/seed-authz-fixtures.mjs)를 먼저 돌렸는지 확인할 것.'
      )
    }
  } finally {
    client.close()
  }
}

test.describe('이메일 인증 관문', () => {
  test.afterEach(async () => {
    await setGate(false)
  })

  test('꺼져 있으면 인증하지 않은 조합원도 지금처럼 로그인된다', async ({ request }) => {
    await setGate(false)

    const response = await request.post('/api/auth/sign-in/email', {
      data: UNVERIFIED,
      headers: fromIp(11),
    })
    expect(response.status()).toBe(200)
  })

  test('켜면 인증하지 않은 조합원의 로그인이 거절된다', async ({ request }) => {
    await setGate(true)

    const response = await request.post('/api/auth/sign-in/email', {
      data: UNVERIFIED,
      headers: fromIp(12),
    })
    expect(response.status()).toBe(403)

    const body = await response.json()
    // 로그인 화면이 이 코드로 "인증 메일 다시 받기"를 띄운다.
    expect(body.code).toBe('EMAIL_NOT_VERIFIED')
    expect(body.message).toContain('이메일 인증')

    // **세션이 만들어지지 않았다.** 로그인시킨 뒤 되돌리는 방식이었다면
    // 여기에 세션 쿠키가 실려 있었을 것이다.
    const cookies = response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie')
    expect(cookies.map(h => h.value).join(';')).not.toContain('session_token')
  })

  test('켜도 인증한 조합원은 아무 영향이 없다', async ({ request }) => {
    await setGate(true)

    const response = await request.post('/api/auth/sign-in/email', {
      data: VERIFIED,
      headers: fromIp(13),
    })
    expect(response.status()).toBe(200)
  })

  test('켜도 관리자는 걸리지 않는다', async ({ request }) => {
    await setGate(true)

    const response = await request.post('/api/auth/sign-in/email', {
      data: ADMIN,
      headers: fromIp(14),
    })
    expect(response.status()).toBe(200)
  })

  test('켜져 있어도 비밀번호가 틀리면 인증 여부가 아니라 자격 증명 오류다', async ({ request }) => {
    await setGate(true)

    const response = await request.post('/api/auth/sign-in/email', {
      data: { email: VERIFIED.email, password: '틀린비밀번호!2026' },
      headers: fromIp(15),
    })
    expect(response.status()).toBe(401)
  })
})
