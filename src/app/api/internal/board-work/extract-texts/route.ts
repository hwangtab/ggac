/**
 * 이사회 업무툴 첨부 문서 본문 추출(설계 §8-2) — 원본 kosmart-work `app/api/internal/extract-texts/route.ts`.
 *
 *  - GET(Vercel 크론, 10분마다): 아직 추출하지 않았거나 재시도할 첨부를 최신 순으로 시간 예산 안에서 처리한다.
 *    한 번에 다 못 하면 다음 실행이 이어서 한다(처리된 첨부는 행이 생겨 제외 — failed 는 1시간 뒤 3회까지).
 *  - POST {ids?, boardDocumentIds?}(업로드 직후 훅 `scheduleTextExtraction`·`scheduleBoardDocumentTextExtraction`):
 *    202 로 먼저 응답하고 응답 뒤(after)에 10MB 이하 파일만 처리한다. 큰 파일·실패분은 크론이 맡는다.
 *  - 대상은 업무툴 첨부와 이사회 서류(`board_documents`, 0034 — 03 §10) 둘이다. 크론은 두 대기열을 섞어 최신 순으로,
 *    같은 상한·예산·재시도 규칙으로 돈다(`extract-store.ts`). 서류 바이트는 서류 저장소에서 경로 판정 뒤에만 읽는다.
 *
 * 인증은 다른 내부 크론과 같다: `CRON_SECRET` Bearer(시간 고정 비교), 없으면 닫는다. 사람의 세션으로는 열리지 않는다 —
 * 그래서 권한(읽기 범위)을 판정하지 않는다. 이 라우트는 결과를 **돌려주지 않고**(개수만) 첨부와 같은 채널 id 로만
 * 저장한다. 읽기 범위는 검색 쿼리가 WHERE 에서 건다. `/api/internal/` 접두사라 점검 모드에서도 돈다(src/middleware.ts).
 *
 * ggac 이식: 원본 `withCronAlert` 자리는 업무툴 크론 감싸개 `withBoardWorkCron`(5단계)이다 — 인증·실행 장부(work_cron_runs)·
 * 실패 알림(구조화 로그·보안 로그)을 맡고, mention-digest 감시가 이 크론이 멈춘 것도 잡는다.
 * kordoc(+ PDF 용 pdfjs-dist·@napi-rs/canvas)을 번들에 남기는 설정은 next.config.js(KORDOC_EXTRACT_ROUTE)에 있다.
 */
import { after } from 'next/server'
import { z } from 'zod'

import { extractBatchFailed } from '@work/lib/files/extract-health'
import {
  extractBoardDocumentsByIds,
  extractByIds,
  runExtractionBatch,
} from '@work/lib/files/extract-store'
import { withBoardWorkCron } from '@work/lib/ops/cron-alert'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/board-work/extract-texts')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 크론 한 번의 시간 한도 — 새 항목을 시작하는 예산(EXTRACT_BUDGET_MS)은 여기서 파일 하나의 최대 추출 시간(60초)을 뺀 값
export const maxDuration = 300

/** 크론 한 번이 새 항목을 시작할 수 있는 시간(ms) */
const EXTRACT_BUDGET_MS = 230_000

const bodySchema = z
  .object({
    ids: z.array(z.string().uuid()).max(20).optional(),
    boardDocumentIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .refine(b => (b.ids?.length ?? 0) + (b.boardDocumentIds?.length ?? 0) > 0)

async function handle(request: Request) {
  if (request.method === 'POST') {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return ApiError.badRequest('잘못된 요청입니다.').toNextResponse()
    const ids = parsed.data.ids ?? []
    const boardDocumentIds = parsed.data.boardDocumentIds ?? []
    after(async () => {
      try {
        if (ids.length > 0) {
          const result = await extractByIds(ids)
          if (result.processed > 0) log.info('업로드 직후 추출', { ...result })
        }
        if (boardDocumentIds.length > 0) {
          const result = await extractBoardDocumentsByIds(boardDocumentIds)
          if (result.processed > 0) log.info('서류 업로드 직후 추출', { ...result })
        }
      } catch (e) {
        log.error('업로드 직후 추출 실패(크론이 이어받음)', e)
      }
    })
    return ApiSuccess.accepted({
      accepted: ids.length + boardDocumentIds.length,
    }).toNextResponse()
  }

  try {
    const result = await runExtractionBatch({ budgetMs: EXTRACT_BUDGET_MS })
    if (extractBatchFailed(result)) {
      // 시도한 파일 대부분이 실패 — 추출기(모듈 로드 등) 문제로 보고 5xx 로 돌려 알린다
      log.error('대부분 실패', result)
      return ApiError.internalServerError('extract mostly failed').toNextResponse()
    }
    if (result.processed > 0) log.info('추출 크론', { ...result })
    return ApiSuccess.ok(result).toNextResponse()
  } catch (err) {
    log.error('추출 크론 실패', err)
    return ApiError.internalServerError('extract failed').toNextResponse()
  }
}

// 인증(CRON_SECRET Bearer, 시간 고정 비교)·실행 장부·실패 알림은 다른 업무툴 크론과 같은 감싸개가 맡는다
const guarded = withBoardWorkCron('extract-texts', handle)
export const GET = guarded
export const POST = guarded
