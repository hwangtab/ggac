import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'

export const runtime = 'nodejs'

/**
 * Better Auth의 모든 엔드포인트를 노출한다.
 *
 * 기존 `/api/auth/logout`·`/api/auth/verify-session`은 더 구체적인 경로라
 * Next.js가 먼저 매칭하므로 그대로 살아 있다(Better Auth에 같은 이름
 * 엔드포인트가 없어 충돌하지 않는다). `/api/auth/reset-password`는 예전에
 * Better Auth의 같은 이름 엔드포인트(POST)를 그렇게 가리고 있었다 — 단계
 * 2b-6(재설정 화면을 Better Auth로 옮기며 실측)에서 그 Supabase 기반
 * 구버전 라우트(`src/app/api/auth/reset-password/route.ts`)를 지워 이제는
 * 이 catch-all이 `/reset-password`도 정상적으로 받는다.
 *
 * `toNextJsHandler`는 GET·POST·PATCH·PUT·DELETE 다섯을 돌려준다(실측:
 * `node_modules/better-auth/dist/integrations/next-js.d.mts`). 둘만 export하면
 * 나머지 메서드를 쓰는 엔드포인트가 405로 죽으므로 전부 내보낸다.
 */
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth)
