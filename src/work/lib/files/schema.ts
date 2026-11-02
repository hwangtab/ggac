import { z } from 'zod'
import type { AttachmentRow } from '@work/lib/messages/types'
import { isRealDate } from './format'
import { isValidFolderPath } from './folders'
import { boundedArray } from '@work/lib/validation/bounded-array'

/** 파일 공유 공용 상수·타입·검증 스키마. 'use server' 파일에서는 export 할 수 없어 여기 둔다. */

/** 절대 상한(MB) — 원본 버킷 한도 5GB(0017). ggac 은 함수가 다운로드를 스트리밍하므로 env 로도 이보다 올리지 않는다 */
export const BUCKET_LIMIT_MB = 5120
/**
 * NEXT_PUBLIC_WORK_MAX_UPLOAD_MB 미설정·잘못된 값일 때의 기본값(설계 §7-2: 파일당 기본 500MB).
 * 원본 운영값 5GB 는 다운로드도 함수가 스트리밍해야 해서 처음에는 낮게 잡는다.
 */
export const DEFAULT_MAX_UPLOAD_MB = 500

/**
 * 파일당 업로드 상한(MB) 해석. 양의 정수만 받고 절대 한도(5120)를 넘으면 5120 으로 줄인다.
 */
export function parseMaxUploadMb(raw: string | undefined): number {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n) || n < 1) return DEFAULT_MAX_UPLOAD_MB
  return Math.min(Math.floor(n), BUCKET_LIMIT_MB)
}

/** 파일당 상한(MB). UI·서버 액션·이관 스크립트가 같은 값을 쓴다(NEXT_PUBLIC_ 라 클라이언트 번들에도 인라인). */
export const MAX_UPLOAD_MB = parseMaxUploadMb(process.env.NEXT_PUBLIC_WORK_MAX_UPLOAD_MB)
/** 호출 시점의 env 로 상한(MB)을 계산한다. 모듈 로드 뒤에 env 를 채우는 CLI 스크립트용(상수는 로드 시점에 고정된다). */
export function getMaxUploadMb(): number {
  return parseMaxUploadMb(process.env.NEXT_PUBLIC_WORK_MAX_UPLOAD_MB)
}

/** 호출 시점의 env 로 상한(바이트)을 계산한다. */
export function getMaxUploadBytes(): number {
  return getMaxUploadMb() * 1024 * 1024
}

/** 파일당 상한(바이트) — 모듈 로드 시점 값 */
export const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024
/** 사용자 안내 문구 */
export const MAX_UPLOAD_MESSAGE = `파일당 최대 ${MAX_UPLOAD_MB}MB까지 올릴 수 있습니다.`
/** 한 번에 첨부할 수 있는 파일 수 */
export const MAX_FILES_PER_MESSAGE = 20
/**
 * 이보다 큰 파일은 Blob 다중 조각 업로드(`multipart: true` — 8MB 조각·동시 6개)로 올린다(설계 §7-2).
 * 원본의 TUS 이어 올리기는 가져오지 않았다 — 새로고침하면 처음부터 다시 올린다.
 */
export const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024
/** 한 사용자가 동시에 쌓아 둘 수 있는 임시 업로드 수(원본 MAX_PENDING_PER_USER, 남용 방지) */
export const MAX_PENDING_PER_USER = 100
/** 임시 업로드 보관 시간(시간) — 크론이 이보다 오래된 것을 지운다 */
export const PENDING_RETENTION_HOURS = 24
/** 서버가 sharp 로 처리하는 이미지 크기 상한(메모리 보호) — 업로드 상한을 올려도 40MB 유지. 초과하면 썸네일 없이 원본만 저장 */
export const MAX_PROCESSABLE_IMAGE_BYTES = 40 * 1024 * 1024

/** 메시지 첨부 행(work.attachments). AttachmentList 의 props 타입. */
export type Attachment = AttachmentRow

export type UploadRequestFile = { name: string; size: number; mime: string }

export const uploadRequestSchema = z.object({
  channelId: z.string().uuid(),
  files: boundedArray(
    z.object({
      name: z.string().min(1).max(512),
      size: z.number().int().min(0).max(MAX_FILE_BYTES),
      mime: z.string().max(255),
    }),
    { min: 1, max: MAX_FILES_PER_MESSAGE }
  ),
})

export const attachRequestSchema = z.object({
  messageId: z.string().uuid(),
  // 같은 uploadId 가 두 번 들어오면 두 번째가 "업로드 미완료"로 실패하고 정상 파일을 지우려 하므로 한 번만 처리한다.
  uploadIds: boundedArray(z.string().uuid(), { min: 1, max: MAX_FILES_PER_MESSAGE }).transform(
    ids => [...new Set(ids)]
  ),
})

/**
 * 클라이언트가 Blob 에 직접 올리기 위한 정보(ggac 이식 — 원본은 서명 URL·TUS 토큰).
 * 브라우저는 `@vercel/blob/client` `upload(pathname, file, { handleUploadUrl, clientPayload: uploadId, contentType: mime })`로
 * 올리고, 토큰 라우트(`/api/board-room/work/uploads`)는 이 uploadId 행의 키·형식·크기로만 토큰을 발급한다.
 */
export type UploadTarget = {
  uploadId: string
  /** 요청한 파일의 순번(요청 배열 index) */
  index: number
  /** 서버가 정한 Blob 키(`board-work/files/<uploadId>/<안전 이름>`) */
  pathname: string
  /** 서버가 정한 형식 — 업로드 Content-Type 으로 그대로 보내야 토큰이 받아들인다 */
  mime: string
  /** true 면 다중 조각 업로드(MULTIPART_THRESHOLD_BYTES 초과) */
  multipart: boolean
}

// ggac 이식: strict false 에서도 ok 판별이 좁혀지게 메시징과 같은 모양을 쓴다
export type { ActionResult } from '@work/lib/channels/action-result'

export type AttachFailure = { uploadId: string; name: string; error: string }
export type AttachResult = { attached: Attachment[]; failed: AttachFailure[] }

/** 자료실 필터 형식 */
export const FILE_KIND_VALUES = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'archive',
  'media',
] as const
export type FileKindFilter = (typeof FILE_KIND_VALUES)[number]

// 실제 있는 날짜만(2026-13-01 이 통과하면 kstDayStart 의 toISOString 이 RangeError 로 500 이 난다)
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, '존재하지 않는 날짜입니다.')
  .optional()

/** /files 쿼리스트링. 잘못된 값은 무시하도록 catch 로 받는다. */
export const filesSearchSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  channel: z.string().uuid().optional().catch(undefined),
  /** 폴더 경로(이관 원본 폴더). 채널이 있고 다른 필터가 없을 때만 쓴다. 잘못된 값은 루트(없음) */
  path: z.string().refine(isValidFolderPath).optional().catch(undefined),
  uploader: z.string().uuid().optional().catch(undefined),
  kind: z.enum(FILE_KIND_VALUES).optional().catch(undefined),
  from: dateString.catch(undefined),
  to: dateString.catch(undefined),
  /** 'all' 이면 이전 버전도 보인다(0032). 기본은 계보당 최신 1개 */
  versions: z.literal('all').optional().catch(undefined),
  view: z.enum(['list', 'grid']).catch('list'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})
export type FilesSearch = z.infer<typeof filesSearchSchema>

/**
 * /files 의 searchParams → 필터. 배열 값은 첫 값, 잘못된 값은 버린다.
 * 검색 결과의 파일 링크 `/files?channel=<uuid>&q=<파일명>` 이 그대로 필터 초기값이 된다.
 */
export function parseFilesSearch(raw: Record<string, string | string[] | undefined>): FilesSearch {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  return filesSearchSchema.parse({
    q: first(raw.q) || undefined,
    channel: first(raw.channel) || undefined,
    path: first(raw.path) || undefined,
    uploader: first(raw.uploader) || undefined,
    kind: first(raw.kind) || undefined,
    from: first(raw.from) || undefined,
    to: first(raw.to) || undefined,
    versions: first(raw.versions) || undefined,
    view: first(raw.view),
    page: first(raw.page),
  })
}
