import { z } from 'zod'

/** 문서 버전 서버 액션 입력 스키마(순수 — 'use server' 파일에서는 export 할 수 없어 여기 둔다). docs/09 §2 */

const uuid = z.string().uuid('잘못된 식별자입니다.')

export const checkoutSchema = z.object({
  attachmentId: uuid,
  /** 남이 수정 중이어도 덮어쓴다(잠금은 안내용) */
  force: z.boolean().optional(),
})

export const releaseSchema = z.object({
  attachmentId: uuid,
  /** true 면 내 잠금만 푼다(남의 것이면 아무것도 안 함 — 관리자 강제 해제 아님) */
  onlyMine: z.boolean().optional(),
})

export const saveVersionSchema = z.object({
  /** 내가 받은(또는 열어 본) 버전 — 이게 계보의 현재 최신이 아니면 충돌 */
  baseAttachmentId: uuid,
  /** createUploadTargets 로 올린 임시 업로드 */
  uploadId: uuid,
  /** "채널에도 알리기" — 기본 끔 */
  announce: z.boolean().optional(),
  /** 충돌이어도 이 파일을 새 최신 버전으로 저장 */
  force: z.boolean().optional(),
  /** 앱 안 문서 편집(docs/10)의 초안 — 게시물 문구에 "(앱에서 문구 수정)"을 붙이고 감사 로그를 남긴다. 초안 메타가 있어야 한다.
   *  'office-edit' = Word·Excel·PPT 앱 편집(docs/11) — 초안 메타 없이 게시물 문구에 "(앱에서 편집)"만 붙인다
   *  'hwp-editor' = HWP 앱 안 편집(docs/12) — verify 라우트가 남긴 초안 메타(mode 'hwp-editor')가 있어야 한다 */
  source: z.enum(['app-edit', 'office-edit', 'hwp-editor']).optional(),
})

export const restoreVersionSchema = z.object({
  versionAttachmentId: uuid,
  announce: z.boolean().optional(),
})

export const markFinalSchema = z.union([
  z.object({ attachmentId: uuid }),
  z.object({ rootAttachmentId: uuid, clear: z.literal(true) }),
])

export const listVersionsSchema = z.object({ attachmentId: uuid })

/** saveFileVersion 이 충돌로 알려 줄 때 보여 줄 최신 버전 */
export type VersionConflictInfo = {
  id: string
  versionNo: number
  name: string
  uploaderName: string | null
  createdAt: string
}

export type SaveVersionOutcome =
  | {
      status: 'saved'
      attachmentId: string
      versionNo: number
      fileName: string
      /** 대화 경로(`/c/<slug>` 또는 `/dm/<id>`) */
      conversationPath: string
    }
  | {
      status: 'conflict'
      latest: VersionConflictInfo
      /** 경합으로 임시 업로드가 이미 쓰였다 — 다시 올려야 저장할 수 있다 */
      uploadConsumed: boolean
    }

export type CheckoutOutcome =
  | { status: 'ok'; until: string }
  | { status: 'held'; heldBy: { userId: string; userName: string | null }; since: string }

/** 자료실 목록 패널의 "내가 수정 중인 파일" 한 줄 */
export type MyCheckoutItem = {
  rootId: string
  /** 지금 최신 버전의 첨부 id */
  attachmentId: string
  name: string
  channelId: string
  channelName: string
  since: string
  until: string
}
