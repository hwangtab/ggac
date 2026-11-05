import { NextRequest, NextResponse } from 'next/server'
import { applyRateLimit, RATE_LIMITS } from '@/lib/server/rateLimit'
import {
  isMemberDocumentsEnabled,
  MEMBER_DOCUMENTS_DISABLED_MESSAGE,
} from '@/lib/memberDocuments/settings'
import { ApiError } from '@/utils/apiWrapper'

/**
 * 조합원 내 문서함 API(`/api/mypage/documents/**`)가 게이트 **다음에** 같이 쓰는 단계 — docs/board-work/04-조합원-문서함.md §4.
 *
 * 순서는 늘 같다: ① 라우트 첫 줄 `requireActiveMember()`(비로그인 401·미승인/정지 403 — 정적 가드가 문자열로 못박는다)
 * ② `memberDocumentsOff()`(스위치가 꺼졌으면 503 — 비회원에게는 스위치 상태를 알리지 않는다) ③ 쓰기면
 * `limitMemberDocumentWrite()` ④ 소유 판정(쿼리 계층이 `owner_id`를 WHERE 에 넣는다 — 남의 id 는 404).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** 스위치가 꺼졌으면 503 응답, 켜졌으면 null */
export async function memberDocumentsOff(): Promise<NextResponse | null> {
  if (await isMemberDocumentsEnabled()) return null
  return ApiError.serviceUnavailable(MEMBER_DOCUMENTS_DISABLED_MESSAGE).toNextResponse()
}

/** 404 — 남의 것·없는 것을 가리지 않는다(존재를 알리지 않는다) */
export function memberDocumentNotFound(): NextResponse {
  return ApiError.notFound('문서를 찾을 수 없습니다.').toNextResponse()
}

const LIMIT_URL = 'https://member-documents.internal/write'

/**
 * 사용자 단위 분산 레이트 리밋 — 쓰기(MEMBER_DOCUMENT_WRITE 분당 90)·편집기 저장본 검사(MEMBER_DOCUMENT_VERIFY 분당 10).
 * 키는 사용자 id(게이트를 지난 뒤라 신원이 확정돼 있다). 넘으면 429 응답, 아니면 null. 쓰기라 리미터 장애 때 닫힌다.
 */
export async function limitMemberDocumentWrite(
  userId: string,
  kind: 'write' | 'verify' = 'write'
): Promise<NextResponse | null> {
  const config =
    kind === 'verify' ? RATE_LIMITS.MEMBER_DOCUMENT_VERIFY : RATE_LIMITS.MEMBER_DOCUMENT_WRITE
  const limiter = await applyRateLimit({
    ...config,
    keyGenerator: () => `rate_limit:${config.name}:${userId}`,
  })
  const result = await limiter(new NextRequest(LIMIT_URL, { method: 'POST' }))
  if (result.success) return null
  return ApiError.tooManyRequests(config.message).toNextResponse()
}
