import type { BatchResult } from './extract-store'

/** 한 실행에서 처리한 파일이 이 개수 이상이고 실패 비율이 이 값 이상이면 실행 전체를 실패로 본다 */
export const EXTRACT_FAIL_MIN_ITEMS = 5
export const EXTRACT_FAIL_RATE = 0.8

/**
 * 추출기 자체가 죽은 경우(예: 모듈 로드 실패 — 시도한 파일이 거의 전부 같은 이유로 실패)를 200 으로 묻지 않는다.
 * 개별 손상 파일은 실패로 쌓이지만(1시간 간격 3회) 대다수가 실패하는 일은 드물다.
 */
export function extractBatchFailed(r: Pick<BatchResult, 'processed' | 'failed'>): boolean {
  return r.processed >= EXTRACT_FAIL_MIN_ITEMS && r.failed / r.processed >= EXTRACT_FAIL_RATE
}
