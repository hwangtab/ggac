import { after } from 'next/server'

/** 추출 라우트(설계 §8-2). `/api/internal/` 아래라 점검 모드에서도 돌고, CRON_SECRET 으로만 열린다 */
export const EXTRACT_ROUTE_PATH = '/api/internal/board-work/extract-texts'

/**
 * 첨부 확정 직후 본문 추출 예약(`attachUploads`·버전 저장·새 문서·문서 편집 저장이 부른다). 서버 액션 번들에 kordoc 이
 * 끌려 들어가지 않도록 추출은 `/api/internal/board-work/extract-texts`(자체 번들·함수 설정)에 HTTP 로 맡긴다 —
 * 이 모듈은 가볍다.
 *
 * - 응답을 막지 않는다: `after()` 로 응답 뒤에 POST 한다(라우트는 202 로 바로 답하고 거기서 다시 after).
 * - 던지지 않는다. 사이트 주소·CRON_SECRET 이 없거나 호출이 실패해도 크론(10분마다)이 따라잡는다.
 *
 * ggac 이식(원본 kosmart-work `lib/files/extract-schedule.ts`): 라우트 경로만 업무툴 아래로 바꿨다.
 */
export function scheduleTextExtraction(attachmentIds: string[]): void {
  postExtraction({ ids: attachmentIds.slice(0, 20) })
}

/**
 * 이사회 서류 업로드 직후 본문 추출 예약(`/api/board-room/documents` POST — 03 §10). 같은 라우트에 `boardDocumentIds`로
 * 맡긴다. 규칙은 위와 같다 — 응답을 막지 않고, 던지지 않고, 실패하면 크론이 따라잡는다(서류 업로드는 성공이다).
 */
export function scheduleBoardDocumentTextExtraction(documentIds: string[]): void {
  postExtraction({ boardDocumentIds: documentIds.slice(0, 20) })
}

function postExtraction(body: { ids?: string[]; boardDocumentIds?: string[] }): void {
  if ((body.ids?.length ?? 0) === 0 && (body.boardDocumentIds?.length ?? 0) === 0) return
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  const secret = process.env.CRON_SECRET
  if (!base || !secret) return
  try {
    after(async () => {
      try {
        const res = await fetch(`${base}${EXTRACT_ROUTE_PATH}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) console.warn('[extract-schedule] 추출 요청 거부:', res.status)
      } catch (e) {
        console.warn('[extract-schedule] 추출 요청 실패(크론이 이어받음):', e)
      }
    })
  } catch {
    // 요청 범위 밖(테스트·스크립트)에서는 after 가 던진다 — 크론이 맡는다.
  }
}
