import {
  claimAttachmentText,
  getExtractionCandidates,
  listPendingExtractionRows,
  upsertAttachmentText,
} from '@/db/queries/work/texts'
import {
  claimBoardDocumentText,
  getBoardDocumentExtractionCandidates,
  listPendingBoardDocumentTextRows,
  upsertBoardDocumentText,
} from '@/db/queries/work/boardDocumentTexts'
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { getBoardDocumentStream } from '@/lib/storage/privateProvider'
import {
  EXTRACT_EXTENSIONS,
  EXTRACT_INLINE_MAX_BYTES,
  EXTRACT_MAX_BYTES,
  extensionOf,
  extractText,
  extractorVersion,
  isExtractable,
  type ExtractOutcome,
} from './extract-text'
import { downloadObject } from './storage'

/**
 * 본문 추출 → work_attachment_texts 저장. 크론·업로드 직후 훅이 같이 쓴다(백필 스크립트는 옮기지 않았다 — 크론이 이어서 한다).
 * 호출 전에 권한 판단은 끝나 있어야 한다(이 모듈은 대상 첨부를 신뢰한다 — 추출 결과는 첨부와 같은 채널 id 로만 저장).
 *
 * ggac 이식(원본 kosmart-work `lib/files/extract-store.ts`): 재시도·선점·메모리 게이트·큰 파일 상한·시간 예산 규칙은
 * 그대로다. 다시 쓴 곳은 DB 접근뿐이다 — service_role 클라이언트(`admin`) 인자와 RPC 대신 쿼리 계층
 * (`src/db/queries/work/texts.ts`)을 부르고, 저장소는 비공개 Blob(`downloadObject`)이다. 테스트가 저장소를 부르지 않게
 * 내려받기·추출 함수를 옵션(`deps`)으로 바꿔 끼울 수 있다.
 *
 * 출처가 둘이다(03 §10): 업무툴 첨부(`work_attachment_texts`, 업무툴 저장소 `downloadObject`)와 이사회 서류
 * (`work_board_document_texts` 0034, 서류 저장소 `getBoardDocumentStream`). 대기열은 둘을 섞어 최신 순으로 돌고,
 * 상한·시간 예산·재시도 규칙은 같다. 서류 경로는 내려받기 전에 `isSafeBoardDocumentFilePath`를 지나야 한다
 * (같은 비공개 저장소에 DB 백업이 있다) — 지나지 못하면 저장소를 부르지 않고 failed 로 남긴다.
 */

/** 재시도 한도 — failed 는 이 횟수까지만 다시 시도한다(원본 attachments_pending_extraction 의 p_max_attempts) */
export const EXTRACT_MAX_ATTEMPTS = 3
/** failed 재시도 간격(ms) — 원본 '1 hour' */
export const EXTRACT_RETRY_AFTER_MS = 60 * 60 * 1000

/** 이보다 큰 파일(10MB 초과)은 메모리를 많이 쓴다 — 같은 인스턴스에서 다른 추출과 겹치지 않게 단독으로 처리한다 */
export const EXTRACT_LARGE_BYTES = 10 * 1024 * 1024
/** 크론 한 번에 처리할 큰 파일의 수·누적 바이트 상한 — 넘는 큰 파일은 다음 실행으로 미룬다(함수 메모리 OOM 방지) */
export const EXTRACT_LARGE_MAX_PER_RUN = 2
export const EXTRACT_LARGE_MAX_TOTAL_BYTES = 60 * 1024 * 1024

/**
 * 추출 메모리 게이트(프로세스 안, FIFO). 큰 파일은 단독(exclusive), 나머지는 서로 겹쳐도 된다(공유).
 * Vercel 은 한 인스턴스가 여러 호출(크론 + 업로드 직후 훅)을 동시에 받아 33MB PDF 와 다른 추출이 겹쳐 OOM 이 났다.
 * 인스턴스가 다르면 막지 못한다 — 크론이 큰 파일을 한 번에 몇 개만 하게 하는 상한(위)이 함께 막는다.
 */
class ExtractGate {
  private active = 0
  private exclusive = false
  private queue: Array<{ exclusive: boolean; grant: () => void }> = []

  acquire(exclusive: boolean): Promise<() => void> {
    return new Promise(resolve => {
      this.queue.push({
        exclusive,
        grant: () => {
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active--
            if (this.active === 0) this.exclusive = false
            this.pump()
          })
        },
      })
      this.pump()
    })
  }

  private pump() {
    while (this.queue.length > 0) {
      const next = this.queue[0]
      const ok = next.exclusive ? this.active === 0 : !this.exclusive
      if (!ok) return
      this.queue.shift()
      this.active++
      this.exclusive = next.exclusive
      next.grant()
    }
  }
}

let extractGate = new ExtractGate()

/** 게이트를 잡고 있는 시간 상한 — 내려받기가 멈추면(응답 없음) 뒤 추출이 영원히 막히지 않게 자동으로 놓는다 */
export const EXTRACT_GATE_HOLD_MS = 120_000

/** 테스트용 — 게이트를 비운다 */
export function resetExtractGate(): void {
  extractGate = new ExtractGate()
}

/** 추출 대상의 출처 — 업무툴 첨부 또는 이사회 서류 */
export type ExtractKind = 'attachment' | 'board_document'

export type ExtractTarget = {
  /** 없으면 'attachment' */
  kind?: ExtractKind
  id: string
  /** 첨부의 채널(이사회 서류는 '') */
  channel_id: string
  name: string
  size: number
  /** Blob 키(원본 열 이름 그대로) */
  bucket_path: string
  /** 지금까지의 시도 횟수(처음이면 0) */
  attempts: number
  /** 올린 시각(epoch ms) — 두 출처를 섞어 최신 순으로 줄 세울 때 */
  created_at?: number
}

const kindOf = (t: ExtractTarget): ExtractKind => t.kind ?? 'attachment'
const keyOf = (t: ExtractTarget) => `${kindOf(t)}:${t.id}`

/** 서류 원본 전체(추출용). 경로 판정은 호출자(extractAndStore)가 먼저 한다 */
async function downloadBoardDocument(path: string): Promise<Buffer> {
  const object = await getBoardDocumentStream(path)
  if (!object?.stream) throw new Error('파일 읽기 실패: 서류 객체가 없습니다')
  return Buffer.from(await new Response(object.stream).arrayBuffer())
}

/** 출처별 선점·저장 — 같은 상태 규칙, 다른 표 */
const textStore = {
  attachment: {
    claim: (id: string, ext: string, extractorVersion: string, attempts: number) =>
      claimAttachmentText({ attachmentId: id, ext, extractorVersion, attempts }),
    upsert: (id: string, row: Omit<Parameters<typeof upsertAttachmentText>[0], 'attachmentId'>) =>
      upsertAttachmentText({ attachmentId: id, ...row }),
  },
  board_document: {
    claim: (id: string, ext: string, extractorVersion: string, attempts: number) =>
      claimBoardDocumentText({ documentId: id, ext, extractorVersion, attempts }),
    upsert: (id: string, row: Omit<Parameters<typeof upsertBoardDocumentText>[0], 'documentId'>) =>
      upsertBoardDocumentText({ documentId: id, ...row }),
  },
} as const

export type StoredStatus = ExtractOutcome['status']

/** 저장소·추출기 바꿔 끼우기(테스트용). 기본은 비공개 Blob 내려받기와 kordoc 추출 */
export type ExtractDeps = {
  download?: (path: string) => Promise<Buffer>
  extract?: (buffer: Buffer, name: string) => Promise<ExtractOutcome>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 대상 하나를 추출해 저장한다. 저장한 상태를 돌려준다(저장 자체가 실패하면 던진다). */
export async function extractAndStore(
  target: ExtractTarget,
  opts: { version?: string; deps?: ExtractDeps } = {}
): Promise<StoredStatus> {
  const version = opts.version ?? (await extractorVersion())
  const kind = kindOf(target)
  const store = textStore[kind]
  const download =
    opts.deps?.download ?? (kind === 'board_document' ? downloadBoardDocument : downloadObject)
  const extract = opts.deps?.extract ?? extractText
  const ext = extensionOf(target.name)
  const attempts = target.attempts + 1
  // 추출을 시작하기 **전에** failed 행을 남긴다(선점, attempts+1). 추출 도중 프로세스가 죽거나(OOM·타임아웃) 저장이
  // 실패해도 행이 있으니, 같은 최신 항목(독 항목)이 매 실행 맨 앞을 차지하며 무한 재시도되지 않는다 — 기존 재시도
  // 규칙(failed·attempts<3·1시간 간격)이 그대로 적용된다. 성공하면 아래 최종 저장이 덮어쓴다.
  try {
    await store.claim(target.id, ext, version, attempts)
  } catch (e) {
    throw new Error(`[extract-texts] 선점 저장 실패: ${messageOf(e)}`, { cause: e })
  }
  let outcome: ExtractOutcome
  if (!isExtractable(target.name)) {
    outcome = { status: 'unsupported' }
  } else if (kind === 'board_document' && !isSafeBoardDocumentFilePath(target.bucket_path)) {
    // 서류 경로는 DB 행에서만 오지만, 같은 저장소에 DB 백업이 있다 — 판정을 지나지 못하면 저장소를 부르지 않는다
    console.error('[extract-texts] 안전하지 않은 서류 경로 — 추출 건너뜀', { id: target.id })
    outcome = { status: 'failed', reason: 'unsafe board document path' }
  } else if (target.size > EXTRACT_MAX_BYTES) {
    // 행의 size 는 승격 때 head()로 확인한 값 — 내려받기 전에 한 번, 받은 뒤 extractText 가 실제 바이트로 또 막는다.
    outcome = { status: 'too_large' }
  } else {
    // 내려받기부터 추출까지가 메모리를 쓴다 — 큰 파일은 단독으로
    const release = await extractGate.acquire(target.size > EXTRACT_LARGE_BYTES)
    const holdTimer = setTimeout(release, EXTRACT_GATE_HOLD_MS)
    holdTimer.unref?.()
    try {
      const buffer = await download(target.bucket_path)
      outcome = await extract(buffer, target.name)
    } catch (e) {
      outcome = {
        status: 'failed',
        reason: e instanceof Error ? e.message.slice(0, 200) : 'error',
      }
    } finally {
      clearTimeout(holdTimer)
      release()
    }
  }
  if (outcome.status === 'failed') {
    console.warn(`[extract-texts] ${target.id} 추출 실패:`, outcome.reason)
  }

  const row = {
    ext,
    content: outcome.status === 'ok' ? outcome.content : '',
    truncated: outcome.status === 'ok' ? outcome.truncated : false,
    status: outcome.status,
    extractorVersion: version,
    attempts,
  }
  try {
    await store.upsert(target.id, row)
  } catch (error) {
    // 본문이 문제였을 수 있다(크기·문자 등) — 본문 없이 failed 행이라도 남겨 재시도 규칙에 태운다.
    try {
      await store.upsert(target.id, { ...row, content: '', truncated: false, status: 'failed' })
    } catch {
      console.error('[extract-texts] 실패 행 저장도 실패:', target.id)
    }
    throw new Error(`[extract-texts] 저장 실패: ${messageOf(error)}`, { cause: error })
  }
  return outcome.status
}

/**
 * 아직 추출하지 않았거나 재시도할 첨부·이사회 서류. 두 출처에서 각각 limit 개까지 가져와 올린 시각 최신 순으로
 * 섞고 limit 개만 돌려준다(같은 규칙 — 확장자 목록·시도 상한·재시도 간격).
 */
export async function fetchPending(
  limit: number,
  nowMs: number = Date.now()
): Promise<ExtractTarget[]> {
  const rule = {
    exts: [...EXTRACT_EXTENSIONS],
    limit,
    maxAttempts: EXTRACT_MAX_ATTEMPTS,
    retryBefore: new Date(nowMs - EXTRACT_RETRY_AFTER_MS),
  }
  try {
    const [attachments, documents] = await Promise.all([
      listPendingExtractionRows(rule),
      listPendingBoardDocumentTextRows(rule),
    ])
    const merged: ExtractTarget[] = [
      ...attachments.map(a => ({ ...a, kind: 'attachment' as const })),
      ...documents.map(d => ({
        kind: 'board_document' as const,
        id: d.id,
        channel_id: '',
        name: d.name,
        size: d.size,
        bucket_path: d.file_path,
        attempts: d.attempts,
        created_at: d.created_at,
      })),
    ]
    return merged
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (b.t.created_at ?? 0) - (a.t.created_at ?? 0) || a.i - b.i)
      .slice(0, Math.max(1, Math.floor(limit) || 1))
      .map(({ t }) => t)
  } catch (e) {
    throw new Error(`[extract-texts] 대상 조회 실패: ${messageOf(e)}`, { cause: e })
  }
}

export type BatchOptions = {
  /** 이 시간(ms)이 지나면 새 항목을 시작하지 않는다 */
  budgetMs: number
  /** 한 번에 가져오는 대상 수 */
  pageSize?: number
  /** 동시 처리 수(서버리스는 1 — 메모리) */
  concurrency?: number
  /** 처리 상한(테스트·점검용) */
  maxItems?: number
  /** 큰 파일(EXTRACT_LARGE_BYTES 초과) 상한 — 이번 실행에서 처리할 수·누적 바이트. 넘으면 다음 실행으로 미룬다. 기본은 서버리스 값 */
  largeMaxCount?: number
  largeMaxBytes?: number
  now?: () => number
  /** 항목 하나를 처리할 때마다(진행 출력용) */
  onItem?: (target: ExtractTarget, status: StoredStatus | 'error', result: BatchResult) => void
  deps?: ExtractDeps
}

export type BatchResult = {
  processed: number
  extracted: number
  unsupported: number
  failed: number
  tooLarge: number
  /** 예산이 다 돼서 멈췄는가(남은 대상이 있을 수 있음) */
  budgetExhausted: boolean
  /** 큰 파일 상한 때문에 다음 실행으로 미룬 수 */
  deferredLarge?: number
}

function emptyResult(): BatchResult {
  return {
    processed: 0,
    extracted: 0,
    unsupported: 0,
    failed: 0,
    tooLarge: 0,
    budgetExhausted: false,
  }
}

function count(result: BatchResult, status: StoredStatus) {
  result.processed++
  if (status === 'ok') result.extracted++
  else if (status === 'unsupported') result.unsupported++
  else if (status === 'too_large') result.tooLarge++
  else result.failed++
}

/**
 * 대상을 가져와 순서대로 처리한다. 시간 예산 안에서만 새 항목을 시작한다.
 * 처리된 항목은 행이 생기므로(failed 는 재시도 간격 동안 제외) 같은 항목을 되풀이하지 않는다.
 */
export async function runExtractionBatch(opts: BatchOptions): Promise<BatchResult> {
  const now = opts.now ?? Date.now
  const started = now()
  const pageSize = opts.pageSize ?? 10
  const concurrency = Math.max(1, opts.concurrency ?? 1)
  const maxItems = opts.maxItems ?? Number.POSITIVE_INFINITY
  const version = await extractorVersion()
  const result = emptyResult()
  const outOfTime = () => now() - started >= opts.budgetMs
  const seen = new Set<string>()
  const largeMaxCount = opts.largeMaxCount ?? EXTRACT_LARGE_MAX_PER_RUN
  const largeMaxBytes = opts.largeMaxBytes ?? EXTRACT_LARGE_MAX_TOTAL_BYTES
  let largeCount = 0
  let largeBytes = 0
  // 미룬 큰 파일은 행이 안 생겨 대기열 앞에 계속 남는다 — 조회 크기를 그만큼 늘려 뒤의 작은 파일이 굶지 않게 한다
  const deferred = new Set<string>()

  while (result.processed < maxItems) {
    if (outOfTime()) {
      result.budgetExhausted = true
      break
    }
    const page = (
      await fetchPending(Math.min(pageSize, maxItems - result.processed) + deferred.size, now())
    ).filter(t => !deferred.has(keyOf(t)))
    // 저장이 계속 실패하면 같은 대상이 되돌아온다 — 새로운 항목이 없으면 멈춘다.
    if (page.length === 0 || page.every(t => seen.has(keyOf(t)))) break
    for (const t of page) seen.add(keyOf(t))

    let cursor = 0
    const worker = async () => {
      while (cursor < page.length && !outOfTime()) {
        const target = page[cursor++]
        if (target.size > EXTRACT_LARGE_BYTES) {
          if (
            largeCount >= largeMaxCount ||
            (largeCount > 0 && largeBytes + target.size > largeMaxBytes)
          ) {
            deferred.add(keyOf(target))
            continue
          }
          largeCount++
          largeBytes += target.size
        }
        try {
          const status = await extractAndStore(target, { version, deps: opts.deps })
          count(result, status)
          opts.onItem?.(target, status, result)
        } catch (e) {
          // 저장 실패 — 행이 안 생겼으니 다음 실행이 다시 집는다. 이번 실행은 계속한다.
          result.processed++
          result.failed++
          console.error('[extract-texts] 처리 실패:', target.id, e)
          opts.onItem?.(target, 'error', result)
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))

    // 예산이 다 돼 페이지를 끝까지 못 돌았다.
    if (cursor < page.length) {
      result.budgetExhausted = true
      break
    }
  }
  if (deferred.size > 0) result.deferredLarge = deferred.size
  return result
}

/** 업로드 직후 훅용 — 지정한 첨부만(작은 파일만) 처리한다. 큰 파일은 크론이 맡는다. */
export async function extractByIds(
  ids: string[],
  opts: { maxBytes?: number; deps?: ExtractDeps } = {}
): Promise<BatchResult> {
  const maxBytes = opts.maxBytes ?? EXTRACT_INLINE_MAX_BYTES
  const result = emptyResult()
  if (ids.length === 0) return result
  let candidates: Awaited<ReturnType<typeof getExtractionCandidates>>
  try {
    candidates = await getExtractionCandidates(ids.slice(0, 20))
  } catch (e) {
    throw new Error(`[extract-texts] 첨부 조회 실패: ${messageOf(e)}`, { cause: e })
  }
  const version = await extractorVersion()
  for (const a of candidates) {
    if (a.done || !isExtractable(a.name) || a.size > maxBytes) continue
    try {
      const status = await extractAndStore(
        {
          id: a.id,
          channel_id: a.channel_id,
          name: a.name,
          size: a.size,
          bucket_path: a.bucket_path,
          attempts: 0,
        },
        { version, deps: opts.deps }
      )
      count(result, status)
    } catch (e) {
      result.processed++
      result.failed++
      console.error('[extract-texts] 처리 실패:', a.id, e)
    }
  }
  return result
}

/** 서류 업로드 직후 훅용 — 지정한 이사회 서류만(작은 파일만) 처리한다. 큰 파일·실패분은 크론이 맡는다. */
export async function extractBoardDocumentsByIds(
  ids: string[],
  opts: { maxBytes?: number; deps?: ExtractDeps } = {}
): Promise<BatchResult> {
  const maxBytes = opts.maxBytes ?? EXTRACT_INLINE_MAX_BYTES
  const result = emptyResult()
  if (ids.length === 0) return result
  let candidates: Awaited<ReturnType<typeof getBoardDocumentExtractionCandidates>>
  try {
    candidates = await getBoardDocumentExtractionCandidates(ids.slice(0, 20))
  } catch (e) {
    throw new Error(`[extract-texts] 서류 조회 실패: ${messageOf(e)}`, { cause: e })
  }
  const version = await extractorVersion()
  for (const d of candidates) {
    if (d.done || !isExtractable(d.name) || d.size > maxBytes) continue
    try {
      const status = await extractAndStore(
        {
          kind: 'board_document',
          id: d.id,
          channel_id: '',
          name: d.name,
          size: d.size,
          bucket_path: d.file_path,
          attempts: 0,
          created_at: d.created_at,
        },
        { version, deps: opts.deps }
      )
      count(result, status)
    } catch (e) {
      result.processed++
      result.failed++
      console.error('[extract-texts] 처리 실패:', d.id, e)
    }
  }
  return result
}
