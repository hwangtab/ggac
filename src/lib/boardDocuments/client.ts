import { upload } from '@vercel/blob/client'

/**
 * 이사회 서류 앱 편집 화면이 API(`/api/board-room/documents/<id>/…`)를 부르는 얇은 층 — 브라우저 전용. 권한은 각 라우트가
 * 요청마다 다시 판정한다(docs/board-work/05-이사회-서류-앱-편집.md §4).
 */

const base = (documentId: string) => `/api/board-room/documents/${documentId}`

export class BoardDocumentApiError extends Error {
  // 클라이언트 번들만 쓰지만 문서함 client 와 같은 모양으로 둔다
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'BoardDocumentApiError'
  }
}

type Envelope<T> = { success?: boolean; data?: T; error?: string; message?: string } | null

async function call<T>(
  url: string,
  init: RequestInit = {}
): Promise<{ data: T; message?: string }> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
    })
  } catch {
    throw new BoardDocumentApiError(
      0,
      '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    )
  }
  const json = (await res.json().catch(() => null)) as Envelope<T>
  if (!res.ok || !json?.success) {
    throw new BoardDocumentApiError(res.status, json?.error || '처리하지 못했습니다.')
  }
  return { data: json.data as T, message: json.message }
}

export type BoardDocumentVersionView = {
  /** 한 번도 고치지 않은 서류의 v1 은 행이 없어 null */
  id: string | null
  versionNo: number
  fileName: string
  fileSize: number
  source: string
  createdByName: string | null
  createdAt: string
  isLatest: boolean
  downloadUrl: string
}

export type BoardDocumentVersionsView = {
  document: {
    id: string
    title: string
    category: string
    fileName: string
    fileSize: number
    mimeType: string | null
    visibility: string
    hasBody: boolean
    latestVersionNo: number
    canEdit: boolean
    editableHere: boolean
  }
  versions: BoardDocumentVersionView[]
}

export async function fetchBoardDocumentVersions(
  documentId: string
): Promise<BoardDocumentVersionsView> {
  return (await call<BoardDocumentVersionsView>(`${base(documentId)}/versions`)).data
}

export type BoardDocumentSaveResponse = {
  documentId: string
  versionId: string
  versionNo: number
  name: string
  bodyUpdated: boolean | null
  fromVersionNo?: number
  objectsDropped?: { tables: number; pictures: number; shapes: number; equations: number }
}

export async function revertBoardDocumentVersion(
  documentId: string,
  revertVersionId: string
): Promise<{ data: BoardDocumentSaveResponse; message?: string }> {
  return call(`${base(documentId)}/versions`, {
    method: 'POST',
    body: JSON.stringify({ revertVersionId }),
  })
}

function uploadErrorMessage(e: unknown): string {
  if (e instanceof BoardDocumentApiError) return e.message
  const name = e instanceof Error ? e.name : ''
  if (name === 'BlobFileTooLargeError') return '저장본이 편집기 상한을 넘어 올릴 수 없습니다.'
  if (name === 'BlobContentTypeNotAllowedError') return '이 형식으로는 저장할 수 없습니다.'
  if (name === 'BlobClientTokenExpiredError') return '업로드 시간이 지났습니다. 다시 저장해 주세요.'
  return '저장본을 올리지 못했습니다.'
}

/**
 * 편집기 저장본을 비공개 저장소에 직접 올리고 새 버전으로 만든다: ① 준비(서버가 키·형식을 정한다) ② `@vercel/blob/client`
 * `upload()`(토큰은 같은 라우트가 그 키로만 발급) ③ `/versions` POST(서버가 저장본을 검사한 뒤 새 버전).
 */
export async function saveBoardDocumentEdit(
  documentId: string,
  file: File,
  opts: {
    baseVersionNo: number | null
    onProgress?: (ratio: number) => void
    onStage?: (stage: 'verify') => void
  }
): Promise<BoardDocumentSaveResponse> {
  const uploadsUrl = `${base(documentId)}/edit-uploads`
  const prepared = await call<{
    target: { uploadId: string; pathname: string; mime: string; multipart: boolean }
  }>(uploadsUrl, {
    method: 'POST',
    body: JSON.stringify({ type: 'prepare', name: file.name, size: file.size }),
  })
  const target = prepared.data.target
  try {
    await upload(target.pathname, file, {
      access: 'private',
      handleUploadUrl: uploadsUrl,
      clientPayload: target.uploadId,
      contentType: target.mime,
      multipart: target.multipart,
      onUploadProgress: ({ loaded, total }) => opts.onProgress?.(total > 0 ? loaded / total : 0),
    })
  } catch (e) {
    throw new BoardDocumentApiError(0, uploadErrorMessage(e))
  }
  opts.onStage?.('verify')
  const saved = await call<BoardDocumentSaveResponse>(`${base(documentId)}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      uploadId: target.uploadId,
      name: file.name,
      baseVersionNo: opts.baseVersionNo,
    }),
  })
  return saved.data
}

/** 바이트 수 → "1.2 MB" */
export function formatBoardDocumentBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** ISO → "2026. 11. 5. 14:05"(KST) */
export function formatBoardDocumentDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}
