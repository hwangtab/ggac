/** 로컬 import 없음 — node --test 가 이 파일을 직접 읽는다 */

/**
 * 원격 DB 연결이 끊겨 난 일시 오류인가 — 원인 사슬(`cause`)에서 `UND_ERR_SOCKET`·`ECONNRESET`·`fetch failed`·`other side
 * closed`를 찾는다. 큰 PDF 를 몇십 초 추출하는 동안 libsql HTTP 의 keep-alive 소켓이 먼저 닫혀, 추출이 끝난 뒤 첫 저장이
 * 이 오류로 실패했다(2026-11-03 운영: 정관 원본 PDF 가 세 번 다 "저장 실패 … other side closed"로 failed 에 굳음).
 */
export function isTransientDbError(e: unknown): boolean {
  let cur: unknown = e
  for (let depth = 0; cur && depth < 8; depth++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (o.code === 'UND_ERR_SOCKET' || o.code === 'ECONNRESET' || o.code === 'UND_ERR_CLOSED') {
      return true
    }
    if (
      typeof o.message === 'string' &&
      /fetch failed|other side closed|socket hang up/i.test(o.message)
    ) {
      return true
    }
    cur = o.cause
  }
  return false
}

/** 일시 연결 오류면 한 번 더 한다(새 요청은 새 소켓을 연다). 그 밖의 오류·두 번째 실패는 그대로 던진다 */
export async function retryOnTransientDbError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (!isTransientDbError(e)) throw e
    return run()
  }
}
