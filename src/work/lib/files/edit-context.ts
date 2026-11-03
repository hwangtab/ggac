import { getAttachmentForEdit, type AttachmentEditRecord } from '@/db/queries/work/versions'
import type { WorkGuardContext } from '@/lib/server/boardWorkAuth'
import {
  loadChannelAccess,
  viewerOf,
  type ChannelAccessDecision,
} from '@/lib/server/boardWorkChannelAuth'
import { dbFailure, fail, ok, type ActionResult } from '@work/lib/channels/action-result'
import { editDeniedMessage, lineageRootId } from './version-rules'

/**
 * 파일 편집 권한 판정(서버 전용) — 원본 kosmart-work version-actions `loadEditContext`·doc-edit-actions 원본 읽기 자리.
 * 'use server' 파일은 async 함수를 export 하면 그대로 공개 엔드포인트가 되므로 판정 도우미는 여기 둔다.
 *
 * 편집 권한(docs/09 §2) = 그 파일을 읽을 수 있고(읽기 범위) + 채널 멤버인 내부 구성원 + 보관 채널 아님 + 게시물 미삭제.
 * 원본은 RLS 클라이언트로 읽어 "읽을 수 없음"이 곧 "없음"이었다 — 여기서도 읽을 수 없으면 NOT_FOUND(존재 여부 비노출).
 */

export const NOT_FOUND = '파일을 찾을 수 없거나 권한이 없습니다.'

export type EditContext = {
  attachment: AttachmentEditRecord
  rootId: string
  channel: AttachmentEditRecord['channel']
  access: ChannelAccessDecision
}

export async function loadEditContext(
  s: Pick<WorkGuardContext, 'user' | 'staff'>,
  attachmentId: string
): Promise<ActionResult<EditContext>> {
  let row: AttachmentEditRecord | null
  let access: ChannelAccessDecision | null
  try {
    row = await getAttachmentForEdit(attachmentId)
    access = row ? await loadChannelAccess(viewerOf(s), row.channel_id) : null
  } catch (e) {
    return dbFailure('versions:context', e)
  }
  if (!row || !access || !access.canRead) return fail(NOT_FOUND)

  const denied = editDeniedMessage(
    { isGuest: s.staff.role === 'guest', isMember: access.isMember },
    { channelArchived: access.archived, messageDeleted: row.message_deleted_at !== null }
  )
  if (denied) return fail(denied)

  return ok({ attachment: row, rootId: lineageRootId(row), channel: row.channel, access })
}
