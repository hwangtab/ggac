/**
 * 정리 크론의 보존 기간 — 원본 kosmart-work `lib/digest/cleanup.ts`·`lib/files/schema.ts`의 값 그대로(순수 상수).
 * 라우트·쿼리·시험이 같은 값을 쓴다.
 */

/** 삭제된 메시지를 이만큼 지난 뒤 영구 삭제한다(첨부 객체·썸네일·미리보기 캐시 포함) */
export const PURGE_AFTER_DAYS = 30
/** last_seen_at이 이만큼 지난 푸시 구독은 버려진 것으로 보고 지운다(남의 endpoint 409도 이 기간이 지나면 교체를 허용) */
export const PUSH_STALE_DAYS = 90
export const DAY_MS = 24 * 60 * 60 * 1000

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}
