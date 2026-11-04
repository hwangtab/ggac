/**
 * 새 메일 작성 요청이 **실패 응답**을 받았을 때, 같은 요청 키를 계속 쓸지 판정한다 — 순수 함수.
 *
 * 요청 키(`idempotency_key`)의 수명이 곧 중복 발송 방지다. 서버가 JSON 오류를 돌려줬다면 그 요청은 서버
 * 코드가 끝까지 판단한 결과(검증 실패·상한 초과·발송 거절 등)라 이 키의 행은 이미 끝난 상태다 — 새 키로
 * 다시 써야 한다. 반대로 JSON이 아닌 응답(플랫폼의 502/503/504 오류 페이지, 프록시의 빈 응답)은 **서버
 * 코드가 끝까지 돌았는지 알 수 없다**: 메일이 이미 나갔는데 응답만 잃었을 수 있다. 그때 새 키를 만들면
 * 사람이 다시 눌러 같은 메일이 두 번 나간다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`의 타입 스트리핑 제약.
 */

export type FailedResponseVerdict =
  /** 서버가 판단을 끝냈다. 새 키로 다시 시도해도 안전하다. */
  | 'rotate-key'
  /** 서버가 아직 처리 중이거나 결과를 알 수 없다. 같은 키를 유지하고 재시도·확인을 안내한다. */
  | 'keep-key'

export function classifyFailedResponse(status: number, body: unknown): FailedResponseVerdict {
  // 409는 서버가 "이 키의 이전 시도가 처리 중이거나 확인이 필요하다"고 답한 것이다.
  if (status === 409) return 'keep-key'

  const serverAnswered =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string' &&
    (body as { success?: unknown }).success === false

  return serverAnswered ? 'rotate-key' : 'keep-key'
}
