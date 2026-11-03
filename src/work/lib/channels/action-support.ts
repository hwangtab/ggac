import { revalidatePath } from 'next/cache'
import { consumeWorkWrite } from '@/lib/server/boardWorkRateLimit'
import { fail, type ActionResult } from './action-result'

/**
 * server action 공용 보조(‘use server’ 파일은 async 함수만 export할 수 있어 따로 둔다).
 */

/** 쓰기 레이트 리밋(WORK_WRITE, 분당 60). 넘으면 실패 결과, 아니면 null */
export async function writeLimited<T = never>(userId: string): Promise<ActionResult<T> | null> {
  const limited = await consumeWorkWrite(userId)
  return limited.ok ? null : fail(limited.message)
}

/**
 * 앱 셸(사이드바) 다시 그리기 — 원본 `revalidatePath('/', 'layout')` 자리.
 * ggac는 공개 사이트와 한 앱이라 루트 전체를 무효화하지 않고 업무툴 경로만 무효화한다.
 */
export function refreshShell() {
  revalidatePath('/[locale]/board-room', 'layout')
}
