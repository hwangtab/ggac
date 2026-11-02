import {
  deletePendingUploads,
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

/** 임시 업로드를 정리한다(객체 + 행). 객체 삭제가 실패하면 행을 남겨 크론(5단계)이 24시간 뒤 다시 지운다. */
export async function discardPending(rows: PendingRow[], uploaderId: string) {
  if (rows.length === 0) return
  try {
    await removeObjects(rows.map(r => r.blobPath))
  } catch (e) {
    // 객체를 못 지웠으면 행을 남겨야 크론이 행을 보고 객체를 다시 지운다. 행까지 지우면 고아 객체가 영구히 남는다.
    console.error('[discardPending] 객체 삭제 실패(행을 남겨 크론이 정리):', e)
    return
  }
  try {
    await deletePendingUploads(
      rows.map(r => r.id),
      uploaderId
    )
  } catch (e) {
    console.error('[discardPending] 행 삭제 실패(크론이 정리):', e)
  }
}

/** 실패 사유를 사용자 문구와 함께 던진다(원본은 Error 메시지를 그대로 실패 목록에 실었다) */
export class PromoteRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromoteRejected'
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

  try {
    return await promotePendingUpload({
      uploadId: row.id,
      messageId: message.id,
      actorId: userId,
      size: stat.size,
      width,
      height,
    })
  } catch (e) {
    // 행을 만들지 못했으면 방금 만든 썸네일은 고아다 — 원본 객체는 호출자가 판단한다
    if (thumbWritten) {
      await removeObjects([thumbPath]).catch(err =>
        console.error('[attachUploads] 썸네일 롤백 삭제 실패:', err)
      )
    }
    throw e
  }
}
