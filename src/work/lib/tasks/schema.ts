import { z } from 'zod'
import { decodeMentions } from '@work/lib/messages/mentions'

/**
 * 할 일 입력 스키마. DB CHECK(0006)와 같은 한도: title 1~200자, note ≤2000자.
 * 'use server' 파일은 async 함수만 export 할 수 있어 여기 둔다.
 */

export const TITLE_MAX = 200
export const NOTE_MAX = 2000

const uuid = z.string().uuid('잘못된 식별자입니다.')

export const titleSchema = z
  .string()
  .trim()
  .min(1, '할 일 제목을 입력해 주세요.')
  .max(TITLE_MAX, `제목은 ${TITLE_MAX}자까지 쓸 수 있습니다.`)

const noteSchema = z
  .string()
  .trim()
  .max(NOTE_MAX, `메모는 ${NOTE_MAX}자까지 쓸 수 있습니다.`)
  .transform(v => (v === '' ? null : v))

/** 빈 문자열·undefined → null */
const optionalUuid = z.preprocess(v => (v === '' || v === undefined ? null : v), uuid.nullable())

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

const dueSchema = z.preprocess(
  v => (v === '' || v === undefined ? null : v),
  z.string().refine(isValidDateOnly, '마감일 형식이 올바르지 않습니다.').nullable()
)

export const createTaskSchema = z.object({
  channelId: uuid,
  title: titleSchema,
  note: noteSchema.optional(),
  assigneeId: optionalUuid.optional(),
  dueOn: dueSchema.optional(),
  messageId: optionalUuid.optional(),
})
export type CreateTaskInput = z.input<typeof createTaskSchema>

/** 키가 없으면(undefined) 바꾸지 않고, null/빈 값이면 비운다 */
export const updateTaskSchema = z
  .object({
    id: uuid,
    title: titleSchema.optional(),
    note: noteSchema.optional(),
    assigneeId: z.preprocess(v => (v === '' ? null : v), uuid.nullable()).optional(),
    dueOn: z
      .preprocess(
        v => (v === '' ? null : v),
        z.string().refine(isValidDateOnly, '마감일 형식이 올바르지 않습니다.').nullable()
      )
      .optional(),
  })
  .refine(
    v =>
      v.title !== undefined ||
      v.note !== undefined ||
      v.assigneeId !== undefined ||
      v.dueOn !== undefined,
    { message: '바꿀 내용이 없습니다.' }
  )
export type UpdateTaskInput = z.input<typeof updateTaskSchema>

export const toggleTaskSchema = z.object({ id: uuid, done: z.boolean() })
export const deleteTaskSchema = z.object({ id: uuid })

/** 메시지 본문 → 할 일 제목 기본값: 멘션 토큰을 @이름으로 풀고 첫 비어 있지 않은 줄, 200자 이내. */
export function defaultTaskTitle(body: string): string {
  const text = decodeMentions(body).text
  const first =
    text
      .split('\n')
      .map(l => l.replace(/^\s*(?:[#>*\-+]+\s*|\d+\.\s+)/, '').trim())
      .find(l => l !== '') ?? ''
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first
}

/** /tasks 의 새 할 일 폼 미리 채우기 쿼리(메시지 메뉴 → 폼) */
export function newTaskHref(message: { id: string; channel_id: string }): string {
  // 본문(첫 줄)을 주소에 싣지 않는다 — 민감 표시 메시지가 기록·공유되는 URL 로 새지 않게.
  // 제목 기본값은 /tasks 페이지(서버)가 messageId 로 읽어 채운다(민감 메시지면 빈 제목).
  const q = new URLSearchParams({ new: '1', channel: message.channel_id, message: message.id })
  return `/tasks?${q.toString()}`
}

export type NewTaskPrefill = { channelId: string | null; messageId: string | null; title: string }

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** searchParams → 미리 채우기 값(검증 실패한 값은 버린다). `new=1` 이 없으면 null */
export function parseNewTaskSearch(
  sp: Record<string, string | string[] | undefined>
): NewTaskPrefill | null {
  if (first(sp.new) !== '1') return null
  const channel = uuid.safeParse(first(sp.channel))
  const message = uuid.safeParse(first(sp.message))
  return {
    channelId: channel.success ? channel.data : null,
    messageId: message.success && channel.success ? message.data : null,
    title: (first(sp.title) ?? '').slice(0, TITLE_MAX),
  }
}
