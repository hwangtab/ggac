import { inspectHwpEditorSave, inspectHwpxEditorSave } from './doc-edit'
import { originalPageCount, renderPages } from './doc-edit-pages'
import { BLOCKED_MESSAGE, pageCountBlocked, type ObjectsDropped } from './doc-edit-types'

/**
 * HWP·HWPX 편집기 저장본 서버 검사(서버 전용 — kordoc 을 부른다). 업무툴 drafts/verify 라우트와 같은 판정을 한 번에 한다:
 * 형식·kordoc 다시 읽기·블록 수, HWP 는 쪽 수 비교. HWPX 개체 감소는 막지 않고 알린다. 원본이 없으면(새 HWPX 문서)
 * 저장본만 본다.
 *
 * 조합원 내 문서함(`src/lib/memberDocuments/promote.ts`, 04 §9)에서 떼어 냈고 이사회 서류 앱 편집
 * (`src/lib/boardDocuments/versions.ts`, 05 §5)이 함께 쓴다 — 판정을 한 곳에 둔다. 이 모듈을 부르는 라우트는
 * next.config.js `KORDOC_ROUTES`에 있어야 한다.
 */
export type EditorInspection = {
  blockedReason: string | null
  objectsDropped: ObjectsDropped | null
}

export async function inspectEditorSave(input: {
  format: 'hwp' | 'hwpx'
  /** `cacheKey`는 원본 쪽 수 캐시(`board-work/renders/<키>-…` 레이아웃 manifest)의 키 — 문서함은 버전 id, 서류는 서류 id */
  original: { bytes: Buffer; cacheKey: string; name: string } | null
  saved: Buffer
  name: string
}): Promise<EditorInspection> {
  const startedAt = Date.now()
  if (input.format === 'hwpx') {
    const r = await inspectHwpxEditorSave(input.original?.bytes ?? null, input.saved)
    return { blockedReason: r.blockedReason, objectsDropped: r.objectsDropped }
  }
  if (!input.original) return { blockedReason: BLOCKED_MESSAGE.original, objectsDropped: null }
  const r = await inspectHwpEditorSave(input.original.bytes, input.saved)
  if (r.blockedReason) return { blockedReason: r.blockedReason, objectsDropped: null }
  const layout = await renderPages(input.saved, input.name, startedAt, 1)
  const before = await originalPageCount(
    input.original.cacheKey,
    input.original.bytes,
    input.original.name,
    startedAt
  )
  const after = layout && !layout.truncated ? layout.pages.length : null
  if (pageCountBlocked(before, after))
    return { blockedReason: BLOCKED_MESSAGE.pages, objectsDropped: null }
  return { blockedReason: null, objectsDropped: null }
}
