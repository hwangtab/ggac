import type { NextRequest } from 'next/server'
import { getCookieCache, getSessionCookie } from 'better-auth/cookies'

const FETCH_TIMEOUT_MS = 3000

/**
 * `auth.api.getSession()`을 미들웨어(Edge 런타임)에서 직접 부르지 않는다.
 *
 * 실측(빌드 실패로 확인, 2026-08-20): `@/lib/auth/server`의 `auth` 객체는
 * `emailAndPassword.password.{hash,verify}` 설정에 `./password.ts`를 정적으로
 * 물고 있고, 그 파일이 `node:crypto`를 쓴다. 미들웨어는 항상 Edge 런타임으로
 * 번들되므로(`experimental.nodeMiddleware` 미설정), 이 객체를 여기서 import하면
 * `next build`가 "UnhandledSchemeError: node:crypto"로 죽는다 — 계획서의
 * `auth.api.getSession()` 직접 호출 예시는 그대로 쓸 수 없다.
 *
 * 대신 `src/app/api/auth/[...all]/route.ts`(`export const runtime = 'nodejs'`로
 * Node 런타임에 고정된 라우트)가 이미 노출하는 `GET /api/auth/get-session`을
 * 같은 오리진으로 fetch한다 — `./profile.ts`가 `member_profiles` 조회에 쓰는
 * 것과 같은 패턴(Node 전용 코드를 Edge 미들웨어에 직접 물지 않고 REST로 왕복).
 * 이 경로는 미들웨어의 유지보수 화이트리스트(`MAINTENANCE_EXEMPT_PREFIXES`,
 * `/api/auth/`)에 걸려 미들웨어를 다시 타도 즉시 통과하므로 재귀하지 않는다.
 */
async function fetchVerifiedSession(request: NextRequest): Promise<{ id: string } | null> {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null

  const res = await fetch(new URL('/api/auth/get-session', request.nextUrl.origin), {
    headers: { cookie, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return null

  const data = (await res.json().catch(() => null)) as { user?: { id?: string } } | null
  return data?.user?.id ? { id: data.user.id } : null
}

/**
 * 미들웨어 전용 신원 판독.
 *
 * 미들웨어는 단계 2b-5가 matcher를 넓혀 모든 요청에서 돈다. `getCookieCache`는
 * 왕복 없이 세션(캐시)을 주고, `session.cookieCache.enabled`가 켜져 있다
 * (`src/lib/auth/server.ts`). 다만 그 캐시는 `maxAge` 5분이라 만료된다 —
 * `fetchVerifiedSession`(DB 왕복)은 그 만료 케이스에서만 쓴다.
 *
 * 3단으로 판정한다:
 *  1. 캐시 히트 → 왕복 없이 id를 돌려준다(대다수 요청).
 *  2. 캐시가 없거나 만료됐는데 세션 쿠키 자체도 없다 → 방문자가 애초에 로그인한
 *     적이 없다는 뜻이므로(익명 트래픽 대다수), 왕복하지 않고 바로 `null`.
 *  3. 세션 쿠키는 있는데 캐시만 만료됐다(5분 지난 로그인 사용자) → 이 경우만
 *     정확한 id가 필요하므로 여기서만 서버에 왕복한다. 이 경로가 드물다는 전제는
 *     클라이언트가 주기적으로(`/api/auth/verify-session`) 세션을 재확인하며 그때마다
 *     Better Auth의 `nextCookies()` 플러그인이 캐시 쿠키를 새로 써 준다는 데 있다.
 *
 * 유지보수 관리자 예외처럼 "취소된 세션을 반드시 감지해야 하는" 경로는 이 함수의
 * 캐시-우선 판정을 쓰지 않는다 — `middleware.ts`가 `fetchVerifiedSession`을 직접
 * 불러 캐시를 건너뛰고 매번 재검증한다.
 */
export async function readMiddlewareSession(request: NextRequest): Promise<{ id: string } | null> {
  try {
    const cached = await getCookieCache(request)
    if (cached?.user?.id) {
      return { id: cached.user.id }
    }

    // 세션 쿠키 자체가 없으면(익명 방문자) 왕복하지 않고 바로 null.
    if (!getSessionCookie(request)) {
      return null
    }

    // 세션 쿠키는 있는데 캐시가 만료됐다 — 정확한 id를 위해서만 서버에 왕복한다.
    return await fetchVerifiedSession(request)
  } catch {
    return null
  }
}

/**
 * 캐시를 신뢰하지 않고 항상 서버(DB)로 재검증한다.
 *
 * 유지보수 모드에서 관리자 우회를 허용하기 직전에만 쓴다 — 취소된 세션(전역
 * 로그아웃·비밀번호 변경)이 쿠키 캐시가 살아있는 동안(최대 5분) 우회를
 * 통과시키면 안 되기 때문이다. 옛 `getUser()` 재검증과 같은 목적이다.
 */
export async function verifySessionFresh(request: NextRequest): Promise<{ id: string } | null> {
  try {
    return await fetchVerifiedSession(request)
  } catch {
    return null
  }
}
