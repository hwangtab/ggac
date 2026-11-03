// Storage 오류 분류 — 순수 모듈(테스트에서 storage.ts 를 통째로 모의해도 이 클래스는 그대로 쓴다).

/** 저장소가 일시적으로 응답하지 않았다(없음이 아님) — 호출자는 임시 객체를 지우지 말고 다시 시도하게 안내한다. */
export class StorageUnavailableError extends Error {
  constructor(detail: string) {
    super(`저장소를 확인하지 못했습니다: ${detail}`)
    this.name = 'StorageUnavailableError'
  }
}

export const STORAGE_RETRY_MESSAGE =
  '저장소가 일시적으로 응답하지 않습니다. 파일은 그대로 두었으니 잠시 뒤 다시 시도해 주세요.'

/** Storage 오류가 "객체 없음"인가(HTTP 404 이거나, 본문 statusCode 404 / NoSuchKey / "Object not found"). */
export function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown }
  if (e.status === 404 || e.status === '404') return true
  if (e.statusCode === 404 || e.statusCode === '404') return true
  if (e.code === 'NoSuchKey') return true
  return typeof e.message === 'string' && /object not found/i.test(e.message)
}
