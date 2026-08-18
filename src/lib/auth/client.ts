import { createAuthClient } from 'better-auth/react'

/**
 * 브라우저에서 Better Auth를 부르는 클라이언트.
 *
 * 단계 2b-1에서는 어떤 화면도 이걸 쓰지 않는다 — 배선만 해두고, 화면 교체는
 * 단계 2b-2다. baseURL을 비워두면 같은 오리진의 `/api/auth`를 쓴다.
 */
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
