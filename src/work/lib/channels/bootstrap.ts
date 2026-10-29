import { ensureWorkspaceEntryRows } from '@/db/queries/work/channels'
import type { WorkServerClient } from '@work/lib/supabase/server'

/**
 * 업무툴 첫 진입 처리 — 레이아웃 로더(`app/[locale]/board-room/(work)/layout.tsx`)가 가드 다음에 부른다(설계 §3).
 * 원본의 초대 수락 단계 자리: 처음 들어온 사람을 공개 채널 `#전체`에 넣고(없으면 만든다) 설정 행을 만든다.
 * 멱등이다 — 이미 돼 있으면 읽기만 한다. 가드(`requireWorkStaff`)에 넣지 않는 이유: 가드는 server action마다 불리므로
 * 쓰기를 섞지 않는다. 실패해도 셸은 그린다(로그만) — 다음 진입에서 다시 시도한다.
 */
export async function ensureWorkspaceEntry(supabase: WorkServerClient): Promise<void> {
  try {
    await ensureWorkspaceEntryRows(supabase.user.id)
  } catch (e) {
    console.error('[ensureWorkspaceEntry] #전체 채널 등록 실패:', e)
  }
}
