/**
 * 감사 기록 — 원본 kosmart-work `lib/audit/log.ts`(`work.audit_log` 표) 자리.
 * ggac에는 업무툴 감사 표가 없다(1단계 범위 밖). 그래서 **구조화된 서버 로그 한 줄**로 남긴다 — Vercel 로그에서
 * `[work-audit]`로 찾는다. 원본처럼 본문은 싣지 않는다(누가·무엇을·어느 채널에서만).
 * 실패해도 본 작업을 막지 않는다(원본도 감사 기록 실패를 삼키고 로그만 남겼다).
 */
export async function logAudit(
  actorId: string,
  action: string,
  target: { type: string; id: string } | null,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    console.info(
      `[work-audit] ${JSON.stringify({ at: new Date().toISOString(), actorId, action, target, meta })}`
    )
  } catch {
    // 직렬화 실패(순환 참조 등)는 무시한다
  }
}
