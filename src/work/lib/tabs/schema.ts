import { z } from 'zod'
import { boundedArray } from '@work/lib/validation/bounded-array'

/**
 * 대화 탭 입력 스키마·상수(순수 — 'use server' 파일에서는 export 할 수 없어 여기 둔다).
 * DB(0023)는 kind 5종을 허용한다. 앱은 website·wiki·tasks(2단계)·file(3단계)·note(4단계) 전부 만든다.
 */

export const TAB_TITLE_MAX = 40
export const TAB_URL_MAX = 2000

/** 이번 단계에서 앱이 만들 수 있는 탭 종류 */
export const APP_TAB_KINDS = ['file', 'website', 'wiki', 'tasks', 'note'] as const
export type AppTabKind = (typeof APP_TAB_KINDS)[number]

export const TAB_KIND_LABEL: Record<AppTabKind, string> = {
  file: '파일',
  website: '웹사이트',
  wiki: '위키 문서',
  tasks: '할 일',
  note: '메모',
}

export const TAB_KIND_DEFAULT_TITLE: Record<AppTabKind, string> = {
  file: '파일',
  note: '메모',
  website: '웹사이트',
  wiki: '위키',
  tasks: '할 일',
}

const uuid = z.string().uuid('잘못된 식별자입니다.')

const titleSchema = z
  .string({ error: '탭 이름을 입력해 주세요.' }) // ggac 이식: zod 4는 required_error 대신 error
  .trim()
  .min(1, '탭 이름을 입력해 주세요.')
  .max(TAB_TITLE_MAX, `탭 이름은 ${TAB_TITLE_MAX}자까지 쓸 수 있습니다.`)

/**
 * https 주소만 허용(http·javascript:·data: 등은 거절). 사용자 정보(user:pw@)가 든 주소도 거절한다.
 * 통과하면 URL 로 정규화한 문자열을 돌려준다.
 */
export function normalizeHttpsUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > TAB_URL_MAX || /[\s\u0000-\u001f]/.test(text)) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
  // 끝점 호스트(`kosmart.org.`)는 같은 사이트 판정·차단 목록을 피하는 우회로라 받지 않는다
  if (url.hostname.endsWith('.')) return null
  return url.toString()
}

const urlSchema = z
  .string({ error: '주소를 입력해 주세요.' }) // ggac 이식: zod 4는 required_error 대신 error
  .trim()
  .min(1, '주소를 입력해 주세요.')
  .transform((v, ctx) => {
    const normalized = normalizeHttpsUrl(v)
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: 'https:// 로 시작하는 올바른 주소만 쓸 수 있습니다.',
      })
      return z.NEVER
    }
    return normalized
  })

export const websiteConfigSchema = z.object({
  url: urlSchema,
  /** true 면 페이지 안에 iframe 으로 보이고, false 면 링크 카드만 */
  embed: z.boolean().default(true),
})
export type WebsiteConfig = z.infer<typeof websiteConfigSchema>

/** 위키 문서 slug — 폴더 구분자 `/`, 상위 이동(`..`)·역슬래시·제어문자 금지 */
export const wikiSlugSchema = z
  .string({ error: '위키 문서를 골라 주세요.' }) // ggac 이식: zod 4는 required_error 대신 error
  .trim()
  .min(1, '위키 문서를 골라 주세요.')
  .max(200)
  .refine(s => !s.split('/').some(p => p === '' || p === '.' || p === '..'), '잘못된 문서입니다.')
  .refine(s => !/[\\\u0000-\u001f]/.test(s), '잘못된 문서입니다.')

export const wikiConfigSchema = z.object({ slug: wikiSlugSchema })
export type WikiConfig = z.infer<typeof wikiConfigSchema>

export const tasksConfigSchema = z.object({}).strict()

/** 메모 탭: 메모 행(work.conversation_notes) id — 탭을 만들 때 서버가 메모와 함께 만든다 */
export const noteConfigSchema = z.object({ noteId: uuid })
export type NoteConfig = z.infer<typeof noteConfigSchema>

/** 파일 탭 이전 버전 기록 상한(config.history) */
export const FILE_TAB_HISTORY_MAX = 20

/** 파일 탭: 지금 보여 줄 첨부 + 이전 버전 첨부 id(최신 → 오래된 순, 최대 20) */
export const fileConfigSchema = z.object({
  attachmentId: uuid,
  history: boundedArray(uuid, { max: FILE_TAB_HISTORY_MAX }).default([]),
})
export type FileConfig = z.infer<typeof fileConfigSchema>

const base = {
  channelId: uuid,
  title: titleSchema,
  /** "게시물에 알리기" — 기본 켬 */
  announce: z.boolean().default(true),
}

export const addTabSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('file'),
    config: z.object({ attachmentId: uuid }),
  }),
  z.object({ ...base, kind: z.literal('website'), config: websiteConfigSchema }),
  z.object({ ...base, kind: z.literal('wiki'), config: wikiConfigSchema }),
  z.object({ ...base, kind: z.literal('tasks'), config: tasksConfigSchema.default({}) }),
  /** 메모 탭은 설정 없이 만든다 — 서버가 메모 행을 만들어 noteId 를 채운다 */
  z.object({ ...base, kind: z.literal('note'), config: tasksConfigSchema.default({}) }),
])
export type AddTabInput = z.input<typeof addTabSchema>

export const renameTabSchema = z.object({ tabId: uuid, title: titleSchema })
export const removeTabSchema = z.object({ tabId: uuid })
export const moveTabSchema = z.object({ tabId: uuid, direction: z.enum(['left', 'right']) })

/** 저장된 config 를 kind 별로 해석(깨진 값이면 null — 화면은 "설정을 읽을 수 없습니다"로 둔다) */
export function parseTabConfig(kind: 'file', config: unknown): FileConfig | null
export function parseTabConfig(kind: 'note', config: unknown): NoteConfig | null
export function parseTabConfig(kind: 'website', config: unknown): WebsiteConfig | null
export function parseTabConfig(kind: 'wiki', config: unknown): WikiConfig | null
export function parseTabConfig(kind: 'tasks', config: unknown): Record<string, never> | null
export function parseTabConfig(kind: AppTabKind, config: unknown): unknown {
  const schema =
    kind === 'file'
      ? fileConfigSchema
      : kind === 'note'
        ? noteConfigSchema
        : kind === 'website'
          ? websiteConfigSchema
          : kind === 'wiki'
            ? wikiConfigSchema
            : tasksConfigSchema
  const parsed = schema.safeParse(config ?? {})
  return parsed.success ? parsed.data : null
}

/** 시스템 메시지 본문에 넣는 제목 — 마크다운 기호를 이스케이프해 서식·링크로 해석되지 않게 한다 */
export function escapeMarkdownInline(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>~]/g, c => `\\${c}`).replace(/\s+/g, ' ')
}

/** "A님이 '제목' 탭을 추가했습니다." */
export function tabAddedMessage(actorName: string, title: string): string {
  return `${escapeMarkdownInline(actorName)}님이 '${escapeMarkdownInline(title)}' 탭을 추가했습니다.`
}

/** 파일 탭용 업로드가 남기는 게시물 본문 — 'A님이 'x' 파일을 올렸습니다.' / 새 버전이면 '… 새 버전을 올렸습니다.' */
export function fileUploadedMessage(
  actorName: string,
  fileName: string,
  purpose: 'tab' | 'version'
): string {
  const who = escapeMarkdownInline(actorName)
  const name = escapeMarkdownInline(fileName)
  return purpose === 'version'
    ? `${who}님이 '${name}' 새 버전을 올렸습니다.`
    : `${who}님이 '${name}' 파일을 올렸습니다.`
}

export const postFileUploadSchema = z.object({
  channelId: uuid,
  fileName: z.string().trim().min(1).max(255),
  purpose: z.enum(['tab', 'version']),
})

export const listChannelFilesSchema = z.object({
  channelId: uuid,
  q: z.string().trim().max(100).optional(),
})
