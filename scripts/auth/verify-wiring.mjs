/**
 * Better Auth 배선이 실제로 도는지 확인한다.
 *
 * 로컬 서버(`npm run start`)를 상대로 가입 → 세션 조회 → 프로필 생성 확인 →
 * 정리까지 한 번 돌린다. 운영에는 절대 쓰지 마라 — 실제 사용자 행이 생긴다.
 *
 * 사용법:
 *   npm run build && npm run start &
 *   node scripts/auth/verify-wiring.mjs
 */
import { createClient } from '@libsql/client'

const BASE = process.env.WIRING_BASE_URL || 'http://localhost:3000'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/**
 * WIRING_BASE_URL이 로컬이 아니면 거부한다.
 * 이 스크립트는 가입 요청을 실제로 쏘고 Turso 행을 지운다 — 누군가 운영
 * URL을 실수로 넣고 돌리면 운영 사이트에 가입 요청이 나가버린다. 기본값
 * (http://localhost:3000)은 안전하지만, 환경변수로 덮어쓸 수 있으니 여기서
 * 한 번 더 막는다.
 */
function assertLocalBaseUrl(base) {
  const hostname = new URL(base).hostname
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1'])
  if (!allowedHosts.has(hostname)) {
    throw new Error(
      `WIRING_BASE_URL이 로컬이 아니다: ${base} (hostname=${hostname}). ` +
        '이 스크립트는 로컬 서버(npm run start)만 상대로 실행해야 한다 — ' +
        '운영 URL을 넣으면 운영 사이트에 실제 가입 요청이 간다.'
    )
  }
}

const email = `wiring-probe-${Date.now()}@example.invalid`
const password = 'probe-password-1234'

/**
 * 이번 실행이 만들었을 수 있는 행을 전부 지운다.
 *
 * userId를 변수로 들고 다니다가 중간 단계에서 던지면 그 변수를 못 받아
 * 정리가 안 되는 경우가 생긴다 — 그래서 userId를 캐시하지 않고, 매번
 * `email`로 서브쿼리해서 user_id/id를 그 자리에서 다시 좁힌다. `email`은
 * 타임스탬프를 포함해 이번 실행에서만 유일하므로, 어느 단계에서 실패해
 * 호출되든 정확히 이번에 만든 행만 지운다. user 행이 아예 안 만들어졌으면
 * (가입 자체가 실패했으면) 서브쿼리가 빈 결과라 DELETE는 그냥 0행에 대해
 * 아무것도 안 한다.
 */
async function cleanup(db) {
  await db.execute({
    sql: 'DELETE FROM member_profiles WHERE id = (SELECT id FROM user WHERE email = ?)',
    args: [email],
  })
  await db.execute({
    sql: 'DELETE FROM account WHERE user_id = (SELECT id FROM user WHERE email = ?)',
    args: [email],
  })
  await db.execute({
    sql: 'DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = ?)',
    args: [email],
  })
  await db.execute({ sql: 'DELETE FROM user WHERE email = ?', args: [email] })
  const left = await db.execute({
    sql: 'SELECT COUNT(*) n FROM user WHERE email = ?',
    args: [email],
  })
  console.log('   남은 user 행', left.rows[0].n)
}

async function main() {
  assertLocalBaseUrl(BASE)

  const db = createClient({
    url: requireEnv('TURSO_DATABASE_URL'),
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  try {
    console.log('1) 가입 시도:', email)
    const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: '배선 점검' }),
    })
    const signUpBody = await signUp.text()
    console.log('   HTTP', signUp.status)
    if (!signUp.ok) {
      console.error('   본문:', signUpBody.slice(0, 300))
      throw new Error('가입 실패 — 배선이 안 됐다')
    }

    console.log('2) user 행 확인')
    const users = await db.execute({
      sql: 'SELECT id, email, email_verified FROM user WHERE email = ?',
      args: [email],
    })
    if (users.rows.length !== 1) throw new Error(`user 행이 ${users.rows.length}개다`)
    const userId = users.rows[0].id
    console.log('   id', userId)

    console.log('2-1) 세션 쿠키가 실제로 붙었는지 확인 (nextCookies 플러그인 검증)')
    const setCookie = signUp.headers.get('set-cookie')
    console.log('   set-cookie', setCookie ? '있음' : '없음')
    if (!setCookie) {
      throw new Error('세션 쿠키가 안 붙었다 — nextCookies() 플러그인이 빠졌을 가능성이 높다')
    }

    console.log('3) account 행에 해시가 들어갔는지 확인 (값은 안 찍는다)')
    const accounts = await db.execute({
      sql: 'SELECT provider_id, length(password) AS pw_len FROM account WHERE user_id = ?',
      args: [userId],
    })
    console.log('   provider', accounts.rows[0]?.provider_id, '해시 길이', accounts.rows[0]?.pw_len)
    if (!accounts.rows[0]?.pw_len) throw new Error('account.password가 비어 있다')

    console.log('4) member_profiles 행이 만들어졌는지 확인')
    const profiles = await db.execute({
      sql: 'SELECT registration_status, is_active, is_admin, display_name FROM member_profiles WHERE id = ?',
      args: [userId],
    })
    if (profiles.rows.length !== 1) throw new Error('프로필이 안 만들어졌다')
    const profile = profiles.rows[0]
    console.log('   ', JSON.stringify(profile))
    if (profile.registration_status !== 'pending') throw new Error('승인 대기가 아니다')
    if (profile.is_active) throw new Error('활성 상태로 만들어졌다')
    if (profile.is_admin) throw new Error('관리자로 만들어졌다')

    console.log('\n배선 확인 완료')
  } finally {
    // try 블록 어디서 던지든(가입 실패 포함) 여기까지는 반드시 온다 — 지금까지
    // 만들어진 행이 있으면 지운다. cleanup 자체가 실패해도 원래 에러를
    // 가리지 않도록 여기서 잡아 로그만 남긴다.
    console.log('5) 정리')
    try {
      await cleanup(db)
    } catch (cleanupError) {
      console.error(
        '   정리 실패:',
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      )
    }
  }
}

main().catch(error => {
  console.error('\n실패:', error.message)
  process.exitCode = 1
})
