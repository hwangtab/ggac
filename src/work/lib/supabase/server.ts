import type { WorkGuardContext } from '@/lib/server/boardWorkAuth'

/**
 * 원본 `WorkServerClient`(사용자 세션을 실은 Supabase RLS 클라이언트) 자리.
 * ggac에는 RLS가 없으므로 조회 함수가 받는 첫 인자는 **"누가 보는가"** — `requireWorkStaff()`의 결과다.
 * 조회 함수(`@work/lib/*\/queries.ts`)는 이 값으로 읽기 범위(원본 readable_channel_ids)를 계산해
 * 쿼리 계층에 넘긴다. 원본 페이지의 `const { supabase, user, staff } = await requireStaff()` →
 * `const ctx = await requireWorkStaff()` 후 `supabase` 자리에 `ctx`를 넘긴다.
 */
export type WorkServerClient = Pick<WorkGuardContext, 'user' | 'staff'>
