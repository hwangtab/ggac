import {
  searchDocumentRows as queryDocumentRows,
  type ReadableScope,
} from '@/db/queries/work/search'
import { makeSnippet, splitTerms } from './text'

/**
 * 첨부 문서 본문 검색(원본 0029 work.search_attachment_texts). 원본은 호출자의 RLS 클라이언트로 실행해 읽을 수 없는
 * 채널·삭제된 메시지의 첨부가 애초에 나오지 않았다 — 여기서는 읽기 범위(`readable`)를 쿼리 계층의 WHERE 에 넣는다.
 * 스니펫은 **평문**이다 — 화면은 Highlight(요소 분할)로만 그리고 raw HTML 은 렌더하지 않는다.
 *
 * ggac 이식: pgroonga 대신 instr(lower(…)) AND(설계 §8-3). SQL 은 첫 일치 주변의 창(600자)만 돌려주고, 화면 스니펫은
 * `makeSnippet`(원본 lib/search/text.ts)이 그 창에서 다듬는다 — 2,000,000자 본문 전체를 앱으로 끌어오지 않는다.
 */

export const DOCUMENT_LIMIT = 20
/** 같은 문서의 여러 버전이 한 계보로 묶여 줄어드는 만큼을 메우려고 더 가져온다(원본 RPC 상한 50) */
export const DOCUMENT_FETCH = 50

export type RawDocumentRow = {
  id: string
  message_id: string
  channel_id: string
  name: string
  mime: string
  size: number
  created_at: string
  snippet: string
  truncated: boolean
}

/** 본문 창 → 화면 스니펫(평문, 앞뒤 생략은 …). 창이 본문 중간이면 앞에, 뒤에 본문이 더 있으면 뒤에 … */
export function documentSnippet(
  row: { window: string; window_at_start: boolean; window_has_more: boolean },
  terms: string[],
  max = 200
): string {
  const text = row.window.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const s = makeSnippet(text, terms, max)
  const lead = !row.window_at_start && !s.startsWith('…') ? '…' : ''
  const tail = row.window_has_more && !s.endsWith('…') ? '…' : ''
  return `${lead}${s}${tail}`
}

/**
 * 본문 검색. 문서 검색은 보조 결과라 쿼리 오류로 검색 전체가 죽지 않게 로그만 남기고 비운다
 * (메시지·파일명 검색은 따로 실패를 알린다).
 */
export async function searchDocumentRows(
  readable: ReadableScope,
  q: string,
  opts: { channelId?: string | null; limit?: number; from?: Date | null; to?: Date | null } = {}
): Promise<RawDocumentRow[]> {
  const terms = splitTerms(q)
  if (terms.length === 0) return []
  try {
    const rows = await queryDocumentRows({
      readable,
      terms,
      channelId: opts.channelId ?? null,
      range: { from: opts.from ?? null, to: opts.to ?? null },
      limit: opts.limit ?? DOCUMENT_FETCH,
    })
    return rows.map(r => ({
      id: r.id,
      message_id: r.message_id,
      channel_id: r.channel_id,
      name: r.name,
      mime: r.mime,
      size: r.size,
      created_at: r.created_at,
      snippet: documentSnippet(r, terms),
      truncated: r.truncated,
    }))
  } catch (e) {
    console.error('[search] 문서 내용 검색 실패, 결과 생략:', e)
    return []
  }
}

/**
 * 파일명 검색 결과와 본문 검색 결과를 합친다(첨부 id 기준 중복 제거).
 *  - 이름과 본문이 둘 다 맞는 파일은 파일 목록에 두고 스니펫만 붙인다.
 *  - 본문만 맞는 파일은 documents 로 남긴다.
 */
export function mergeDocumentHits<F extends { id: string }, D extends { id: string }>(
  files: F[],
  docs: D[],
  snippetOf: (d: D) => string
): { files: Array<F & { snippet?: string }>; documents: D[] } {
  const snippets = new Map(docs.map(d => [d.id, snippetOf(d)]))
  const fileIds = new Set(files.map(f => f.id))
  return {
    files: files.map(f => (snippets.has(f.id) ? { ...f, snippet: snippets.get(f.id) } : f)),
    documents: docs.filter(d => !fileIds.has(d.id)),
  }
}
