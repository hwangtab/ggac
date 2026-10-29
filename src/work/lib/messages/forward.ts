import { z } from 'zod'
import { uuidSchema } from '@work/lib/channels/schema'
import { escapeMarkdownInline } from '@work/lib/tabs/schema'
import { decodeMentions } from './mentions'

/**
 * 전달(0028) 규칙(순수) — 서버 액션과 대화상자가 같이 쓴다.
 *
 * 결정: Teams 처럼 원문을 **복사**한다. 전달 메시지 본문 =
 *   [코멘트]
 *
 *   > **전달된 메시지** · <원 작성자> · <원 대화 이름>
 *   > <원문 줄들>
 * 원본 접근 권한이 없는 사람도 읽을 수 있게 하기 위해서다. 대신 비공개 채널·DM·그룹 원본이면
 * 대화상자가 "원래 대화에 없는 사람도 보게 됩니다" 확인을 받고, 서버도 confirmed 없이는 거부한다.
 * 원문 링크(카드)는 messages.forwarded_from_id 임베드로 그린다 — 원본을 못 읽는 사람에게는 "볼 수 없음".
 * 멘션 토큰은 `@이름` 평문으로 바꿔 복사한다(전달이 새 멘션 알림을 만들지 않게).
 */

/** 첨부 복제 상한: 개수·합계(넘으면 복제하지 않고 원문 링크만) */
export const FORWARD_MAX_ATTACHMENTS = 10
export const FORWARD_MAX_BYTES = 1024 * 1024 * 1024
/** 복사하는 원문·코멘트 길이 상한(본문 CHECK 40,000자 안에 들도록) */
export const FORWARD_COPY_MAX_CHARS = 10000
export const FORWARD_COMMENT_MAX_CHARS = 2000

export const forwardInputSchema = z.object({
  messageId: uuidSchema,
  targetChannelId: uuidSchema,
  comment: z
    .string()
    .max(FORWARD_COMMENT_MAX_CHARS, '코멘트가 너무 깁니다(최대 2,000자).')
    .optional(),
  /** 비공개 채널·DM 원본을 전달한다는 확인(원래 대화에 없는 사람도 보게 됨) */
  confirmed: z.boolean().optional(),
  /** 클라이언트가 만든 새 메시지 id — 재시도·더블클릭이 두 번 전달되지 않게(sendMessage 방식) */
  id: uuidSchema.optional(),
})
export type ForwardInput = z.input<typeof forwardInputSchema>

/** 원본이 비공개 대화(비공개 채널·DM·그룹)인가 — 전달 전에 확인을 받는다 */
export function needsForwardConfirm(sourceKind: string | null | undefined): boolean {
  return sourceKind !== 'public'
}

export function buildForwardBody(input: {
  comment?: string | null
  authorName: string
  conversationName: string
  originalBody: string
}): string {
  const text = decodeMentions(input.originalBody).text.trim()
  const clipped =
    text.length > FORWARD_COPY_MAX_CHARS ? `${text.slice(0, FORWARD_COPY_MAX_CHARS)}…` : text
  const header = `**전달된 메시지** · ${escapeMarkdownInline(input.authorName)} · ${escapeMarkdownInline(input.conversationName)}`
  const quoted = [header, ...(clipped ? clipped.split('\n') : [])]
    .map(l => (l.length > 0 ? `> ${l}` : '>'))
    .join('\n')
  const comment = input.comment?.trim()
  return comment ? `${comment}\n\n${quoted}` : quoted
}

export type ForwardAttachmentLike = { size: number }

/**
 * 첨부 복제 계획. 개수·합계가 상한 안이면 전부 복제, 넘으면 하나도 복제하지 않는다(링크만).
 * 일부만 복제하면 "어느 파일이 빠졌는지"를 받는 사람이 알 수 없어서 전부/전무로 한다.
 */
export function planAttachmentForward<T extends ForwardAttachmentLike>(
  attachments: readonly T[]
): { copy: T[]; linkOnly: boolean; total: number } {
  const total = attachments.reduce((sum, a) => sum + a.size, 0)
  if (attachments.length === 0) return { copy: [], linkOnly: false, total }
  if (attachments.length > FORWARD_MAX_ATTACHMENTS || total > FORWARD_MAX_BYTES) {
    return { copy: [], linkOnly: true, total }
  }
  return { copy: [...attachments], linkOnly: false, total }
}

/** 대화상자의 대상 한 줄 */
export type ForwardTarget = {
  id: string
  name: string
  kind: 'public' | 'private' | 'dm'
  group: boolean
  /** 공지 채널이라 내가 글을 올릴 수 없다(비활성 표시) */
  restricted: boolean
}

/** 대상 검색(이름 부분 일치, 대소문자 무시) */
export function filterForwardTargets(
  targets: readonly ForwardTarget[],
  query: string
): ForwardTarget[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...targets]
  return targets.filter(t => t.name.toLowerCase().includes(q))
}
