import { randomUUID } from 'crypto'
import { getPendingUpload } from '@/db/queries/work/files'
import { insertDraftPendingUpload } from '@/db/queries/work/versions'
import { DRAFT_PREVIEW_MAX_PAGES, isDraftMeta, type DraftMeta } from './doc-edit-types'
import { resolveMime } from './mime'
import { buildUploadPath, displayFileName } from './paths'
import { discardPending, type PendingRow } from './promote'
import type { LayoutResult } from './render-layout'
import { RENDER_CACHE_DIR } from './render-types'
import { removeObjects, uploadBuffer } from './storage'

/**
 * 문서 편집 초안의 저장(서버 전용) — 원본 kosmart-work `lib/files/doc-edit-draft.ts`(docs/10 §3-1)를 Blob·Turso 로 다시 썼다.
 * 초안 = `work_pending_uploads` 행(+ draft_meta) + `board-work/files/<uploadId>/<안전 이름>` 객체(일반 업로드와 같은 키 모양).
 * 미리보기 레이아웃(manifest·쪽 SVG)은 `board-work/renders/<uploadId>-draft-layout….{json,svg}`에 둔다 — 원본은 pending
 * 폴더에 두고 목록으로 찾아 지웠지만, Blob 은 경로 봉쇄(`isSafeBoardWorkPath`)가 허용하는 모양이 둘뿐이라 렌더 캐시 쪽에 두고
 * 경로를 계산해 지운다(목록 조회가 없다). 문서 내용은 어디에도 로그로 남기지 않는다.
 */

/** 초안이 쓸 수 있는 임시 업로드 상한(채팅 첨부 몫 100개 중 일부를 남겨 둔다) */
export const DRAFT_PENDING_CAP = 90
const UPLOAD_PARALLEL = 8

export function draftManifestPath(uploadId: string): string {
  return `${RENDER_CACHE_DIR}/${uploadId}-draft-layout.json`
}
export function draftPagePath(uploadId: string, page: number): string {
  return `${RENDER_CACHE_DIR}/${uploadId}-draft-layout-p${page}.svg`
}

export type SavedDraft = { uploadId: string; blobPath: string }

/** 초안 파일을 임시 업로드로 저장한다. 상한을 넘으면 `{ error: 'cap' }`, 그 밖의 실패는 던진다 */
export async function saveDraftUpload(input: {
  userId: string
  channelId: string
  name: string
  data: Buffer
  meta: DraftMeta
}): Promise<SavedDraft | { error: 'cap' }> {
  const uploadId = randomUUID()
  const name = displayFileName(input.name)
  const path = buildUploadPath(uploadId, name)
  const mime = resolveMime(null, name)
  await uploadBuffer(path, input.data, mime)
  let inserted: boolean
  try {
    inserted = await insertDraftPendingUpload(
      {
        id: uploadId,
        channelId: input.channelId,
        uploaderId: input.userId,
        blobPath: path,
        name,
        mime,
        size: input.data.length,
        draftMeta: input.meta,
      },
      { maxPerUser: DRAFT_PENDING_CAP }
    )
  } catch (e) {
    await removeObjects([path]).catch(() => undefined)
    throw e
  }
  if (!inserted) {
    await removeObjects([path]).catch(() => undefined)
    return { error: 'cap' }
  }
  return { uploadId, blobPath: path }
}

/** 미리보기 레이아웃을 저장한다. 실패해도 초안은 유효하다(미리보기만 못 본다) — 성공 여부를 돌려준다 */
export async function storeDraftLayout(uploadId: string, result: LayoutResult): Promise<boolean> {
  try {
    // 초안 미리보기는 앞쪽만 둔다(DRAFT_PREVIEW_MAX_PAGES) — 정리할 객체 수를 묶어 두고, 전체 쪽 수는 응답의 pageCount 가 따로 알린다
    // 쪽 목록은 문서 전체일 수 있다 — 그림이 있거나 "너무 큼" 표시인 쪽만 싣는다(예산이 모자라 못 그린 쪽은 뺀다)
    const kept = result.pages.filter(
      p => p.page <= DRAFT_PREVIEW_MAX_PAGES && (result.svgs.has(p.page) || p.tooLarge === true)
    )
    const entries = [...result.svgs.entries()].filter(([page]) => page <= DRAFT_PREVIEW_MAX_PAGES)
    for (let i = 0; i < entries.length; i += UPLOAD_PARALLEL) {
      await Promise.all(
        entries
          .slice(i, i + UPLOAD_PARALLEL)
          .map(([page, svg]) =>
            uploadBuffer(draftPagePath(uploadId, page), Buffer.from(svg), 'image/svg+xml')
          )
      )
    }
    // manifest 는 마지막 — 있으면 쪽 SVG 가 다 올라갔다는 표시
    await uploadBuffer(
      draftManifestPath(uploadId),
      Buffer.from(
        JSON.stringify({
          pages: kept,
          warnings: result.warnings,
          truncated: result.truncated || kept.length < result.pages.length,
        })
      ),
      'application/json'
    )
    return true
  } catch {
    return false
  }
}

/** 이미 있는 임시 업로드 행의 미리보기 레이아웃을 저장한다(HWP 앱 안 편집 검증용) */
export function saveDraftLayoutFor(
  row: Pick<PendingRow, 'id'>,
  result: LayoutResult
): Promise<boolean> {
  return storeDraftLayout(row.id, result)
}

/** 내 초안 행(소유·초안 메타 확인). 아니면 null */
export async function getMyDraft(
  userId: string,
  uploadId: string
): Promise<{ row: PendingRow; meta: DraftMeta } | null> {
  const row = await getPendingUpload(uploadId, userId)
  if (!row || !isDraftMeta(row.draftMeta)) return null
  return { row, meta: row.draftMeta }
}

/** 초안의 미리보기 캐시 객체 경로 전부(쪽 상한까지 계산 — 없는 객체 삭제는 무시된다) */
export function draftLayoutPaths(uploadId: string): string[] {
  const out = [draftManifestPath(uploadId)]
  for (let p = 1; p <= DRAFT_PREVIEW_MAX_PAGES; p++) out.push(draftPagePath(uploadId, p))
  return out
}

/** 미리보기 캐시만 치운다(초안을 새 버전·새 문서로 저장한 뒤 — 객체는 첨부가 되었다) */
export async function discardDraftPreview(uploadId: string): Promise<void> {
  await removeObjects(draftLayoutPaths(uploadId)).catch(e =>
    console.error(
      '[doc-edit-draft] 미리보기 캐시 삭제 실패(무시):',
      e instanceof Error ? e.name : 'unknown'
    )
  )
}

/** 초안 하나를 치운다(객체·미리보기 캐시·행). 실패는 정리 크론에 맡긴다 */
export async function discardDraftUpload(row: PendingRow): Promise<void> {
  await discardDraftPreview(row.id)
  await discardPending([row], row.uploaderId)
}
