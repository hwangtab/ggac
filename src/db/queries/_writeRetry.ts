/**
 * 쓰기 트랜잭션의 락 경합 재시도. `ticketing.ts`의 `holdReservation` 루프를
 * 일반화한 것이다(ticketing은 이번에 바꾸지 않았다 — 같은 모양이라 나중에
 * 옮겨도 된다).
 *
 * libSQL 드라이버는 `db.transaction`을 `BEGIN IMMEDIATE`로 열어 첫 문장부터 쓰기
 * 잠금을 쥔다. 겹친 쓰기는 기다리지 않고 `SQLITE_BUSY`로 즉시 실패하는데,
 * 트랜잭션이 실패하면 아무것도 남지 않으므로 다시 해도 안전하다. 그 밖의 실패
 * (판정 거부·상태 오류·제약 위반)는 다시 해도 결과가 같으므로 곧바로 던진다.
 *
 * **로컬 `file:` DB의 함정(실측 2026-11-02, @libsql/client 0.17).** `BEGIN
 * IMMEDIATE`가 `SQLITE_BUSY`로 실패하면 드라이버가 그 문장을 리셋하지 않은 채
 * 그 연결을 클라이언트의 기본 연결로 계속 쓴다. 그 연결로 연 다음 트랜잭션은
 * `cannot commit transaction - SQL statements in progress`로 끝나고, 그 뒤로는
 * 잠금이 풀리지 않아 **모든 쓰기가 영영 `SQLITE_BUSY`**가 된다. 그래서 경합을
 * 만나면 다시 하기 전에 기본 연결을 새로 연다(`reconnect`). 트랜잭션은 자기
 * 연결을 따로 쥐고 있으므로 진행 중인 다른 트랜잭션에는 영향이 없다. 원격
 * Turso(`libsql://`)는 이 문제가 없어 건드리지 않는다.
 */

import { rawClient } from '../client.ts'

/** 락 경합인가. 잠시 뒤 다시 하면 되는 실패와 진짜 오류를 가른다. */
export function isLockContention(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = error instanceof Error ? error.message : String(error)
  return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(message)
}

/** 로컬 파일 DB면 기본 연결을 새로 연다(위 머리 주석). 실패해도 재시도는 계속한다. */
async function healLocalConnection(): Promise<void> {
  try {
    if (rawClient.protocol === 'file') await rawClient.reconnect()
  } catch {
    // 새로 열지 못해도 다음 시도가 제 이유로 실패한다 — 여기서 삼킨다.
  }
}

const DEFAULT_ATTEMPTS = 6
const BASE_DELAY_MS = 25

/**
 * `fn`을 부르고, 락 경합으로 실패하면 물러났다가 다시 부른다. `fn`은 매번
 * **트랜잭션 하나를 처음부터** 여는 함수여야 한다(부분 재시도는 없다).
 *
 * - `isFatal(e)`가 참이면 경합처럼 보여도 곧바로 던진다.
 * - 경합이 아닌 실패는 언제나 곧바로 던진다.
 * - 마지막 시도의 경합 오류는 그대로 던진다.
 */
export async function withWriteRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; isFatal?: (e: unknown) => boolean }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? DEFAULT_ATTEMPTS)
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (opts?.isFatal?.(error)) throw error
      if (!isLockContention(error)) throw error
      lastError = error
      await healLocalConnection()
      if (attempt === attempts - 1) break
      // 지터를 섞는다 — 같은 순간에 부딪힌 요청들이 같은 순간에 다시 부딪히지 않게.
      const delay = BASE_DELAY_MS * (attempt + 1) + Math.floor(Math.random() * BASE_DELAY_MS)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
