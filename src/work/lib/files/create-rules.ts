import { z } from 'zod'
import { formatDay } from '@work/lib/format/datetime'
import { escapeMarkdownInline } from '@work/lib/tabs/schema'
import { isValidFolderPath } from './folders'
import { HWPX_MIME } from './hwp-editor'
import { officeMimeFor } from './office-edit'
import { displayFileName } from './paths'

/**
 * 새 문서 만들기(docs/16)의 순수 규칙 — 형식 목록·이름 정리·노출 판정·입력 스키마.
 * 'use server' 파일(create-actions)은 async 함수만 export 할 수 있어 여기 둔다. 서버·화면·테스트가 같이 쓴다.
 */

export type OfficeCreateType = 'docx' | 'xlsx' | 'pptx'
/** 만들 수 있는 형식 — 오피스 3종 + 한글 문서(HWPX, docs/18: rhwp 편집기) */
export type CreateDocumentType = OfficeCreateType | 'hwpx'

export type CreateDocumentTypeInfo = {
  type: CreateDocumentType
  /** 메뉴 문구 */
  label: string
  /** 기본 파일 이름(날짜 앞) */
  defaultName: string
  /** 정적 빈 서식(public/doc-templates) */
  templatePath: string
}

/** 오피스 편집기 종류(Word·Excel·PPT). 한글 문서(HWPX)는 `HWPX_CREATE_TEMPLATES` / `createTypeInfo('hwpx')` */
export const CREATE_DOCUMENT_TYPES: readonly (CreateDocumentTypeInfo & {
  type: OfficeCreateType
})[] = [
  {
    type: 'docx',
    label: 'Word 문서',
    defaultName: '새 문서',
    templatePath: '/doc-templates/blank.docx',
  },
  {
    type: 'xlsx',
    label: 'Excel 통합 문서',
    defaultName: '새 통합 문서',
    templatePath: '/doc-templates/blank.xlsx',
  },
  {
    type: 'pptx',
    label: 'PowerPoint 프레젠테이션',
    defaultName: '새 프레젠테이션',
    templatePath: '/doc-templates/blank.pptx',
  },
]

/**
 * 한글 문서(HWPX) 시작 서식(docs/18 §3) — 정적 파일 `public/doc-templates/*.hwpx`(scripts/make-doc-templates.ts 로 생성).
 * 지금은 빈 문서 하나다 — 보고서(공문) 서식은 빈 문서에서 바로 쓰는 것과 다르지 않아 뺐다(2026-10-29 사용자 결정).
 * 조합 양식을 더하면 대화상자에 서식 선택이 다시 나타난다(서식이 둘 이상일 때만 보인다).
 */
export const HWPX_TEMPLATE_IDS = ['blank'] as const
export type HwpxTemplateId = (typeof HWPX_TEMPLATE_IDS)[number]

export type HwpxTemplateInfo = {
  id: HwpxTemplateId
  label: string
  description: string
  /** 기본 파일 이름(확장자·날짜 제외) */
  defaultName: string
  templatePath: string
}

export const HWPX_CREATE_TEMPLATES: readonly HwpxTemplateInfo[] = [
  {
    id: 'blank',
    label: '빈 문서',
    description: '아무것도 없는 새 한글 문서',
    defaultName: '새 문서',
    templatePath: '/doc-templates/blank.hwpx',
  },
]

export function hwpxTemplateInfo(id: string | null | undefined): HwpxTemplateInfo {
  return HWPX_CREATE_TEMPLATES.find(t => t.id === id) ?? HWPX_CREATE_TEMPLATES[0]
}

const HWPX_TYPE_INFO: CreateDocumentTypeInfo = {
  type: 'hwpx',
  label: '한글 문서(HWPX)',
  defaultName: '새 문서',
  templatePath: '/doc-templates/blank.hwpx',
}

export function createTypeInfo(type: CreateDocumentType): CreateDocumentTypeInfo {
  if (type === 'hwpx') return HWPX_TYPE_INFO
  return CREATE_DOCUMENT_TYPES.find(t => t.type === type) ?? CREATE_DOCUMENT_TYPES[0]
}

/** 이름(확장자 제외) 길이 상한 */
export const CREATE_NAME_MAX = 100

/** 기본 이름(확장자 없음): "새 문서 10월 28일" */
export function defaultDocumentName(type: CreateDocumentType, now: Date = new Date()): string {
  return `${createTypeInfo(type).defaultName} ${formatDay(now, now)}`
}

/** 입력에 붙여 온 Office·한글 확장자 */
const TRAILING_OFFICE_EXT = /\.(docx?|xlsx?|pptx?|hwpx?)$/i

/**
 * 파일 이름 정리 — 경로 문자·제어문자 제거, 붙여 온 Office 확장자는 떼고 형식 확장자를 고정으로 붙인다.
 * 이름이 비면(점·공백·구분자뿐이어도) null(거부). 길이는 CREATE_NAME_MAX 로 자른다.
 */
export function normalizeCreateFileName(raw: string, type: CreateDocumentType): string | null {
  const stripped = raw.trim().replace(TRAILING_OFFICE_EXT, '').trim()
  if (!/[^.\s\\/]/.test(stripped)) return null
  const base = displayFileName(stripped).slice(0, CREATE_NAME_MAX).trim()
  if (!base) return null
  return `${base}.${type}`
}

/** 게시물 본문: "A님이 새 문서 'x.docx'를 만들었습니다." (한글 문서는 "새 한글 문서") */
export function createdDocumentBody(
  actor: string,
  fileName: string,
  type?: CreateDocumentType
): string {
  const noun = type === 'hwpx' ? '새 한글 문서' : '새 문서'
  return `${escapeMarkdownInline(actor)}님이 ${noun} '${escapeMarkdownInline(fileName)}'를 만들었습니다.`
}

export type CreateActor = {
  isGuest: boolean
  isMember: boolean
  archived: boolean
  postPolicy: string | null | undefined
  isChannelOwner: boolean
  isAdmin: boolean
  /** 스레드 안에서 만든다(parentId 있음) */
  inThread: boolean
}

/**
 * 새 문서 만들기 노출 조건(env·PC 판정은 호출부). 서버(createDocument)도 같은 기준으로 거절한다.
 * 내부 staff(게스트 아님) · 채널 멤버 · 보관 채널 아님 · 최상위 생성이면 공지 채널은 owner·관리자만(스레드 안은 누구나).
 */
export function canOfferCreateDocument(opts: CreateActor): boolean {
  if (opts.isGuest || !opts.isMember || opts.archived) return false
  if (opts.inThread) return true
  if (opts.postPolicy === 'owners') return opts.isChannelOwner || opts.isAdmin
  return true
}

/** 거절 문구(서버) — 허용이면 null */
export function createDeniedMessage(opts: CreateActor): string | null {
  if (opts.isGuest) return '외부 참여자는 새 문서를 만들 수 없습니다.'
  if (!opts.isMember) return '이 채널의 멤버만 새 문서를 만들 수 있습니다.'
  if (opts.archived) return '보관된 채널에서는 새 문서를 만들 수 없습니다.'
  if (!canOfferCreateDocument(opts)) {
    return '이 채널은 소유자와 관리자만 새 글을 올릴 수 있습니다. 스레드 안에서 만들어 주세요.'
  }
  return null
}

/** 서식 MIME — 확장자 기준(편집기가 알려 주는 값을 믿지 않는다) */
export function createMimeFor(type: CreateDocumentType): string {
  if (type === 'hwpx') return HWPX_MIME
  return officeMimeFor(`x.${type}`)
}

const uuid = z.string().uuid('잘못된 식별자입니다.')
const typeSchema = z.enum(['docx', 'xlsx', 'pptx', 'hwpx'])

/** `/edit/new` 쿼리 */
export const createDocumentQuerySchema = z.object({
  channel: uuid,
  type: typeSchema,
  /** type=hwpx 의 시작 서식(docs/18 §3). 없거나 모르면 빈 문서 */
  template: z.enum(HWPX_TEMPLATE_IDS).optional().catch(undefined),
  name: z.string().max(300).optional(),
  folder: z.string().max(1000).optional(),
  parent: uuid.optional(),
  /** 첫 저장 때 만들 게시물 id — 대화상자가 정한다. 새로고침해도 같은 id 라 이미 만든 문서를 알아본다 */
  id: uuid.optional(),
})

export type CreateDocumentQuery = z.infer<typeof createDocumentQuerySchema>

/** 쿼리의 folder → 정규화된 폴더 경로(없거나 잘못되면 null = 루트) */
export function normalizeCreateFolder(raw: string | null | undefined): string | null {
  if (!raw) return null
  return isValidFolderPath(raw) ? raw : null
}

/** `/edit/new` 주소 만들기(대화상자 → 이동) */
export function createDocumentHref(opts: {
  channelId: string
  type: CreateDocumentType
  template?: HwpxTemplateId
  name: string
  folder?: string | null
  parentId?: string | null
  /** 첫 저장 때 만들 게시물 id(없으면 주소에 넣지 않는다 — 화면이 새로 정한다) */
  messageId?: string
}): string {
  const q = new URLSearchParams({ channel: opts.channelId, type: opts.type, name: opts.name })
  if (opts.type === 'hwpx' && opts.template) q.set('template', opts.template)
  if (opts.folder) q.set('folder', opts.folder)
  if (opts.parentId) q.set('parent', opts.parentId)
  if (opts.messageId) q.set('id', opts.messageId)
  return `/edit/new?${q.toString()}`
}

/** createDocument 입력 */
export const createDocumentSchema = z.object({
  messageId: uuid,
  channelId: uuid,
  uploadId: uuid,
  type: typeSchema,
  fileName: z.string().trim().min(1, '파일 이름을 입력해 주세요.').max(300),
  folderPath: z.string().max(1000).nullish(),
  parentId: uuid.nullish(),
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>

export type CreateDocumentOutcome = {
  attachmentId: string
  fileName: string
  versionNo: 1
  conversationPath: string
}

// ── 사본으로 새 문서 (docs/16 §6) ───────────────────────────────────────────

/** 확장자를 `ext`(점 없음, 빈 문자열이면 없음)로 고정한 이름. 이름이 비면 null */
export function normalizeFileNameWithExt(raw: string, ext: string): string | null {
  const e = ext.toLowerCase()
  let stripped = raw.trim()
  if (e && stripped.toLowerCase().endsWith(`.${e}`)) stripped = stripped.slice(0, -(e.length + 1))
  stripped = stripped.trim()
  if (!/[^.\s\\/]/.test(stripped)) return null
  const base = displayFileName(stripped).slice(0, CREATE_NAME_MAX).trim()
  if (!base) return null
  return e ? `${base}.${e}` : base
}

/** 이름의 확장자(점 없음, 소문자). 없으면 '' */
export function fileExtOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ''
}

/** 사본 기본 이름(확장자 제외): "보고서 사본" */
export function copyDefaultStem(sourceName: string): string {
  const ext = fileExtOf(sourceName)
  const stem = ext ? sourceName.slice(0, sourceName.length - ext.length - 1) : sourceName
  return `${stem} 사본`
}

/** 게시물 본문: "A님이 'x.docx'의 사본 'y.docx'를 만들었습니다." */
export function copiedDocumentBody(actor: string, source: string, created: string): string {
  return `${escapeMarkdownInline(actor)}님이 '${escapeMarkdownInline(source)}'의 사본 '${escapeMarkdownInline(created)}'를 만들었습니다.`
}

export const copyAsNewDocumentSchema = z.object({
  messageId: uuid,
  sourceAttachmentId: uuid,
  fileName: z.string().trim().min(1, '파일 이름을 입력해 주세요.').max(300),
})

export type CopyAsNewDocumentOutcome = {
  attachmentId: string
  fileName: string
  conversationPath: string
}
