import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'

export const runtime = 'nodejs'

/**
 * Better Auth의 모든 엔드포인트를 노출한다.
 *
 * 기존 `/api/auth/logout`·`/api/auth/reset-password`·`/api/auth/verify-session`은
 * 더 구체적인 경로라 Next.js가 먼저 매칭하므로 그대로 살아 있다. 그중
 * `reset-password`는 Better Auth의 같은 이름 엔드포인트를 가린다 — 단계 2b-1에서는
 * 아직 어떤 화면도 Better Auth를 부르지 않으므로 문제되지 않고, 단계 2b-2가
 * 기존 라우트를 걷어낼 때 풀린다.
 *
 * `toNextJsHandler`는 GET·POST·PATCH·PUT·DELETE 다섯을 돌려준다(실측:
 * `node_modules/better-auth/dist/integrations/next-js.d.mts`). 둘만 export하면
 * 나머지 메서드를 쓰는 엔드포인트가 405로 죽으므로 전부 내보낸다.
 */
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth)
