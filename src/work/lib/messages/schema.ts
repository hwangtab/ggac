import { z } from 'zod'
import { uuidSchema } from '@work/lib/channels/schema'
import type { MessageCursor } from './types'
import { boundedArray } from '@work/lib/validation/bounded-array'

/** DB CHECK: body ≤ 40000자 */
export const MESSAGE_BODY_MAX = 40000
export const MAX_ATTACHMENTS_PER_MESSAGE = 20

const bodySchema = z.string().max(MESSAGE_BODY_MAX, '메시지가 너무 깁니다(최대 40,000자).')

export const sendMessageSchema = z
  .object({
    channelId: uuidSchema,
    /** 클라이언트가 미리 만든 id — 낙관적 표시와 실시간 이벤트를 같은 행으로 맞춘다 */
    messageId: uuidSchema,
    body: bodySchema,
    parentId: uuidSchema.nullish(),
    /** 인용 답장 대상(같은 채널의 메시지만 — DB 트리거가 검사, 0028) */
    quotedMessageId: uuidSchema.nullish(),
    /** 파일 영역이 올린(또는 올릴) 첨부 id. 있으면 본문이 비어도 보낼 수 있다 */
    attachmentIds: boundedArray(uuidSchema, {
      max: MAX_ATTACHMENTS_PER_MESSAGE,
      maxMessage: '첨부는 한 번에 20개까지입니다.',
    }).optional(),
  })
  .refine(v => v.body.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0, {
    message: '메시지를 입력해 주세요.',
    path: ['body'],
  })
export type SendMessageInput = z.input<typeof sendMessageSchema>

export const editMessageSchema = z.object({
  messageId: uuidSchema,
  body: bodySchema.refine(v => v.trim().length > 0, '메시지를 입력해 주세요.'),
})

export const messageIdSchema = z.object({ messageId: uuidSchema })

export const reactionSchema = z.object({
  messageId: uuidSchema,
  emoji: z
    .string()
    .trim()
    .min(1, '이모지를 골라 주세요.')
    .max(32, '이모지가 너무 깁니다.')
    .refine(v => !/[\s<>]/.test(v) && !/^[\x20-\x7e]+$/.test(v), '이모지만 쓸 수 있습니다.'),
})

export const pinSchema = z.object({ channelId: uuidSchema, messageId: uuidSchema })

const isoSchema = z.string().refine(v => !Number.isNaN(Date.parse(v)), '잘못된 시각입니다.')

export const cursorSchema = z.object({ created_at: isoSchema, id: uuidSchema })

export const loadOlderSchema = z.object({
  channelId: uuidSchema,
  before: cursorSchema,
})

export const threadSchema = z.object({ parentId: uuidSchema })

/** PostgREST or() 필터: (created_at, id) 보다 앞선 행 */
export function beforeCursorFilter(cursor: MessageCursor): string {
  const ts = `"${cursor.created_at}"`
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${cursor.id})`
}
