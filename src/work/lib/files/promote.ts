import { findReferencedBlobPaths } from '@/db/queries/work/cleanup'
import {
  claimPendingUploads,
  promotePendingUpload,
  type WorkPendingUploadRecord,
} from '@/db/queries/work/files'
import { createThumbnail, readImageInfo } from './image'
import { isProcessableImage } from './mime'
import { thumbPathOf } from './paths'
import { checkPromotable, PROMOTE_FAILURE_MESSAGE } from './upload-rules'
import { MAX_FILE_BYTES, MAX_PROCESSABLE_IMAGE_BYTES, type Attachment } from './schema'
import { downloadObject, removeObjects, statObject, uploadBuffer } from './storage'

/**
 * 임시 업로드(pending) → 메시지 첨부 승격. 'use server' 파일에서는 async 함수만 export 할 수 있어 별도 모듈로 뺐다.
 * 원본 kosmart-work `lib/files/promote.ts`를 다시 썼다(설계 §7-1·§7-2):
 * - 객체를 옮기지 않는다 — 처음부터 최종 키에 올렸고, 승격은 DB 행만 바꾼다(`promotePendingUpload`가 한 트랜잭션에서
 *   임시 행 삭제 → 첨부 행 생성 → 메시지 첨부 수·rev 갱신).
 * - 크기·형식 검사는 저장소 `head()` 결과로 한다(`checkPromotable`).
 * - 이미지 썸네일(`.thumb.webp`)은 원본처럼 sharp 로 만든다. 실패는 치명적이지 않다.
 */

export type PendingRow = WorkPendingUploadRecord

/**
 * 임시 업로드를 정리한다(행 → 객체 순서). **행을 먼저 지우고, 실제로 지운 행의 객체만 지운다.**
 *
 * 예전 순서(객체 → 행)는 저장과 폐기가 겹치면 위험했다: 저장(승격)이 아직 남아 있는 임시 행으로 커밋하는 사이 폐기가 그
 * 객체를 지우면, 새 최신 버전·첨부가 없는 객체를 가리켰다(화면을 떠나며 정리·대화상자 닫기·첨부 칩 X 와 저장이 겹칠 때 —
 * 2026-11-05 감사). 지금은 승격이 먼저 끝났으면 행이 없어 여기서 아무것도 지우지 않고, 폐기가 먼저면 승격이 not_found 로
 * 실패한다. 행을 지운 뒤 객체 삭제가 실패하면 고아 객체가 남고 정리 크론의 고아 청소(`sweepOrphanObjects`)가 치운다.
 */
export async function discardPending(rows: PendingRow[], uploaderId: string) {
  if (rows.length === 0) return
  let claimed: string[]
  try {
    claimed = await claimPendingUploads(
      rows.map(r => r.id),
      uploaderId
    )
  } catch (e) {
    console.error('[discardPending] 행 삭제 실패(객체를 남기고 크론이 정리):', e)
    return
  }
  const gone = new Set(claimed)
  const paths = rows.filter(r => gone.has(r.id)).map(r => r.blobPath)
  if (paths.length === 0) return
  try {
    await removeObjects(paths)
  } catch (e) {
    console.error('[discardPending] 객체 삭제 실패(고아 객체 — 크론 고아 청소가 정리):', e)
  }
}

/**
 * 복사본(되돌리기·사본 만들기)의 저장이 실패했을 때 그 복사 객체를 치운다 — **어떤 첨부 행도 그 키를 가리키지 않을 때만**.
 * DB 응답이 끊겨 예외가 났어도 커밋은 됐을 수 있다(libsql HTTP: COMMIT 반영 뒤 응답 유실). 그때 지우면 방금 만든 최신 버전·
 * 사본이 없는 객체를 가리킨다(2026-11-05 감사). 확인 조회가 실패하면 지우지 않는다 — 고아 객체는 크론 고아 청소가 치운다.
 */
export async function removeCopyUnlessReferenced(path: string, withThumb: boolean): Promise<void> {
  let referenced: boolean
  try {
    referenced = (await findReferencedBlobPaths([path])).has(path)
  } catch {
    return
  }
  if (referenced) return
  await removeObjects(withThumb ? [path, thumbPathOf(path)] : [path]).catch(() => undefined)
}

/** 실패 사유를 사용자 문구와 함께 던진다(원본은 Error 메시지를 그대로 실패 목록에 실었다) */
export class PromoteRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromoteRejected'
  }
}

export type PreparedPromotion = {
  size: number
  width: number | null
  height: number | null
  /** 행을 만들지 못했을 때 방금 만든 썸네일을 지운다(원본 객체는 호출자가 판단한다) */
  rollback: () => Promise<void>
}

/**
 * 승격 전 저장소 단계(원본 promoteOne 의 stat·검사·이미지 처리) — 객체 크기·형식을 `head()`로 확인하고 이미지면 썸네일을
 * 만든다. 검사에 실패하면 PromoteRejected, 저장소 일시 오류는 StorageUnavailableError 를 그대로 던진다.
 * 버전 저장·새 문서(version-actions·create-actions)는 이 결과로 게시물 + 첨부를 한 트랜잭션에서 만든다.
 */
export async function preparePromotion(row: PendingRow): Promise<PreparedPromotion> {
  const stat = await statObject(row.blobPath)
  const check = checkPromotable(row, stat, MAX_FILE_BYTES)
  if (!check.ok) throw new PromoteRejected(PROMOTE_FAILURE_MESSAGE[check.reason])

  let width: number | null = null
  let height: number | null = null
  const thumbPath = thumbPathOf(row.blobPath)
  let thumbWritten = false
  if (isProcessableImage(row.mime) && stat.size <= MAX_PROCESSABLE_IMAGE_BYTES) {
    // 이미지 처리 실패는 치명적이지 않다 — 썸네일·크기 없이 원본만 저장한다.
    try {
      const original = await downloadObject(row.blobPath)
      const info = await readImageInfo(original)
      if (info) {
        width = info.width
        height = info.height
      }
      const thumb = await createThumbnail(original)
      if (thumb) {
        await uploadBuffer(thumbPath, thumb.buffer, thumb.contentType)
        thumbWritten = true
      }
    } catch (e) {
      console.error('[attachUploads] 이미지 처리 실패(원본만 저장):', e)
    }
  }
  return {
    size: stat.size,
    width,
    height,
    rollback: async () => {
      if (!thumbWritten) return
      await removeObjects([thumbPath]).catch(err =>
        console.error('[attachUploads] 썸네일 롤백 삭제 실패:', err)
      )
    },
  }
}

/**
 * 임시 업로드 1건을 메시지 첨부로 승격한다. 검사에 실패하면 PromoteRejected 를 던진다(호출자가 임시 객체를 지운다).
 * 저장소 일시 오류는 StorageUnavailableError 로 그대로 던진다(호출자가 임시 객체를 남긴다).
 */
export async function promoteOne(
  row: PendingRow,
  message: { id: string; channel_id: string },
  userId: string
): Promise<Attachment> {
  if (row.channelId !== message.channel_id) throw new PromoteRejected('다른 채널의 업로드입니다.')
  const prepared = await preparePromotion(row)
  try {
    return await promotePendingUpload({
      uploadId: row.id,
      messageId: message.id,
      actorId: userId,
      size: prepared.size,
      width: prepared.width,
      height: prepared.height,
    })
  } catch (e) {
    await prepared.rollback()
    throw e
  }
}
