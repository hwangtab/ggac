/**
 * 쓰기 트랜잭션의 락 경합 재시도 — 타임뱅크용 얇은 어댑터.
 *
 * 구현·측정 기록(로컬 `file:` DB의 `SQLITE_BUSY` 뒤 기본 연결 재연결 등)은
 * 전부 `_helpers.ts`의 `retryOnLockContention`/`healLocalConnection`에 있다.
 * 여기에는 `withWriteRetry`의 옛 시그니처(`attempts`, `isFatal`)만 남긴다.
 */

import { isLockContention, retryOnLockContention, WRITE_RETRY_BUDGET } from './_helpers.ts'

export { isLockContention }

/**
 * `fn`을 부르고, 락 경합이면 물러났다가 다시 부른다. `fn`은 매번 **트랜잭션
 * 하나를 처음부터** 여는 함수여야 한다. `isFatal`이 참이면 경합이어도 던진다.
 */
export function withWriteRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; isFatal?: (e: unknown) => boolean }
): Promise<T> {
  return retryOnLockContention(fn, {
    budget: { ...WRITE_RETRY_BUDGET, attempts: opts?.attempts ?? WRITE_RETRY_BUDGET.attempts },
    isFinal: opts?.isFatal,
  })
}
