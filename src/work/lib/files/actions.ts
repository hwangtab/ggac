'use server'

import { z } from 'zod'
import { getPendingUploads } from '@/db/queries/work/files'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { fetchMessage } from '@work/lib/messages/queries'
import { discardPending, promoteOne, PromoteRejected } from './promote'
import {
  attachRequestSchema,
  type ActionResult,
  type AttachFailure,
  type AttachResult,
  type Attachment,
} from './schema'
import { STORAGE_RETRY_MESSAGE, StorageUnavailableError } from './storage-errors'
import { StorageUnconfiguredError } from './storage'

/**
 * 첨부 server action — 원본 kosmart-work `lib/files/actions.ts`와 같은 이름·반환 모양(설계 §7-2).
 *
 * ① 업로드 준비(원본 createUploadTargets)는 토큰 라우트(`POST /api/board-room/work/uploads`)로 옮겼다 — 브라우저가 Blob
 *    에 직접 올리려면 그 라우트가 토큰을 발급해야 하고, 준비와 발급이 같은 게이트(requireBoardMember → 채널 멤버)를 탄다.
 * ①-2 이어 올리기 토큰 재발급(renewUploadTarget)은 없다 — TUS 를 가져오지 않았다.
 * ② attachUploads: 메시지 전송 직후 임시 업로드를 그 메시지의 첨부로 확정한다.
 * ③ discardUploads: 취소·포기한 임시 업로드를 지운다.
 */

/**
 * ② 메시지 전송 후 첨부 확정 — 저장소 `head()`로 크기·형식을 확인하고 DB 행만 바꾼다(객체는 이미 최종 키에 있다).
 * 메시지 작성자 본인만, 임시 업로드도 본인 것·같은 채널이어야 한다(쿼리 계층이 트랜잭션 안에서 다시 본다).
 * 실패한 파일은 failed 로 돌려주고 임시 객체를 지운다(③). 저장소 일시 오류면 남겨 둔다(다시 시도하면 이어서 붙는다).
 */
export async function attachUploads(
  messageId: string,
  uploadIds: string[]
): Promise<ActionResult<AttachResult>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = attachRequestSchema.safeParse({ messageId, uploadIds })
  if (!parsed.success) return { ok: false, error: '첨부 정보가 올바르지 않습니다.' }

  // 읽기 범위 안에서 읽고(원본 RLS messages_select), 작성자 본인인지 확인한다.
  let message: Awaited<ReturnType<typeof fetchMessage>>
  try {
    message = await fetchMessage(ctx, parsed.data.messageId)
  } catch (e) {
    console.error('[attachUploads] 메시지 조회 실패:', e)
    return { ok: false, error: '메시지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  if (!message || message.author_id !== user.id || message.deleted_at) {
    return { ok: false, error: '첨부할 메시지를 찾을 수 없습니다.' }
  }

  let pending: Awaited<ReturnType<typeof getPendingUploads>>
  try {
    // 문서 편집 초안(draft_meta)은 저장 액션으로만 승격한다 — 일반 첨부로 우회 금지(3단계)
    pending = await getPendingUploads(parsed.data.uploadIds, user.id)
  } catch (e) {
    console.error('[attachUploads] 임시 업로드 조회 실패:', e)
    return { ok: false, error: '첨부를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  const byId = new Map(pending.map(r => [r.id, r]))
  const attached: Attachment[] = []
  const failed: AttachFailure[] = []

  // 요청 순서를 보존하되 파일은 하나씩 처리한다(대용량 이미지 처리의 메모리 보호).
  for (const uploadId of parsed.data.uploadIds) {
    const row = byId.get(uploadId)
    if (!row) {
      failed.push({ uploadId, name: '', error: '업로드 정보를 찾을 수 없습니다.' })
      continue
    }
    try {
      attached.push(await promoteOne(row, message, user.id))
    } catch (e) {
      if (e instanceof StorageUnavailableError || e instanceof StorageUnconfiguredError) {
        // 저장소 일시 오류 — 올라간 객체와 임시 행은 그대로 둔다(다시 시도하면 이어서 첨부된다)
        console.error('[attachUploads] 저장소 일시 오류 — 임시 파일 유지:', row.name, e)
        failed.push({ uploadId, name: row.name, error: STORAGE_RETRY_MESSAGE })
        continue
      }
      if (isWorkWriteError(e, 'not_found')) {
        // 임시 행이 이미 없다 — 같은 업로드를 다른 요청이 먼저 승격했을 수 있다. 객체는 그 첨부의 것이라 지우지 않는다.
        failed.push({ uploadId, name: row.name, error: '업로드 정보를 찾을 수 없습니다.' })
        continue
      }
      const error =
        e instanceof PromoteRejected
          ? e.message
          : isWorkWriteError(e, 'invalid_target')
            ? '다른 채널의 업로드입니다.'
            : isWorkWriteError(e, 'archived')
              ? '보관된 채널에는 첨부할 수 없습니다.'
              : '첨부하지 못했습니다.'
      console.error('[attachUploads] 파일 첨부 실패:', row.name, e)
      failed.push({ uploadId, name: row.name, error })
      await discardPending([row], user.id)
    }
  }

  // 문서 본문 검색 색인은 4단계(추출 크론)다.
  return { ok: true, data: { attached, failed } }
}

/** ③ 사용자가 첨부를 취소했거나 전송을 포기했을 때 임시 업로드를 지운다(본인 것만). */
export async function discardUploads(
  uploadIds: string[]
): Promise<ActionResult<{ removed: number }>> {
  const { user } = await requireWorkStaff()
  const parsed = z
    .array(z.string().uuid())
    .min(1)
    .max(20)
    .transform(ids => [...new Set(ids)])
    .safeParse(uploadIds)
  if (!parsed.success) return { ok: false, error: '요청이 올바르지 않습니다.' }
  let rows: Awaited<ReturnType<typeof getPendingUploads>>
  try {
    rows = await getPendingUploads(parsed.data, user.id, { includeDrafts: true })
  } catch (e) {
    console.error('[discardUploads] 조회 실패:', e)
    return { ok: false, error: '임시 파일을 정리하지 못했습니다.' }
  }
  await discardPending(rows, user.id)
  return { ok: true, data: { removed: rows.length } }
}
