/**
 * KST(Asia/Seoul, UTC+9, DST 없음) 날짜 헬퍼. Next 임포트 없음 — 쿼리 계층이 써도 된다.
 *
 * 주의: `daily_activity_stats.activity_date`는 예전에 UTC 날짜로 쌓였다. 이 헬퍼로
 * 바꾼 뒤로는 KST 날짜로 쌓이며, 기존 행은 이행하지 않는다(경계 일자는 KST 00:00~09:00
 * 활동이 전날로 잡힌 채 남는다).
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 주어진 시각의 KST 달력 날짜 'YYYY-MM-DD'. */
export function kstDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}
