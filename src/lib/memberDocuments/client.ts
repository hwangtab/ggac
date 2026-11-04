import { upload } from '@vercel/blob/client'
import { MEMBER_DOCUMENT_EDITOR_USED_KEY } from './rules'

/**
 * 조합원 내 문서함 화면이 API(`/api/mypage/documents/**`)를 부르는 얇은 층 — 브라우저 전용. 권한은 각 라우트가
 * 요청마다 다시 판정한다(docs/board-work/04-조합원-문서함.md §4).
 */

export const MEMBER_DOCUMENTS_API = '/api/mypage/documents'
/** 미리보기 부품(FilePreviewBody·DocumentViewer)의 API 기준 경로 — `<base>/<버전 id>`·`/<name>`·`/render` */
export const MEMBER_DOCUMENT_FILE_API_BASE = `${MEMBER_DOCUMENTS_API}/files`
const UPLOADS = `${MEMBER_DOCUMENTS_API}/uploads`

export class MemberDocumentApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'MemberDocumentApiError'
  }
}

type Envelope<T> = { success?: boolean; data?: T; error?: string } | null

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
    })
  } catch {
    throw new MemberDocumentApiError(
      0,
      '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    )
  }
  const json = (await res.json().catch(() => null)) as Envelope<T>
  if (!res.ok || !json?.success) {
    throw new MemberDocumentApiError(res.status, json?.error || '처리하지 못했습니다.')
  }
  return json.data as T
}

export type PromoteResponse = {
  documentId: string
  versionId: string
  versionNo: number
  name: string
  objectsDropped?: { tables: number; pictures: number; shapes: number; equations: number }
}

function uploadErrorMessage(e: unknown): string {
  if (e instanceof MemberDocumentApiError) return e.message
  const name = e instanceof Error ? e.name : ''
  if (name === 'BlobFileTooLargeError') return '파일 한 개는 50MB까지 올릴 수 있습니다.'
  if (name === 'BlobContentTypeNotAllowedError') return '이 형식으로는 올릴 수 없습니다.'
  if (name === 'BlobClientTokenExpiredError') return '업로드 시간이 지났습니다. 다시 올려 주세요.'
  return '업로드하지 못했습니다.'
}

/**
 * 파일 하나를 비공개 저장소에 직접 올리고 임시 업로드 id 를 돌려준다: ① 준비(서버가 키·형식을 정하고 용량을 본다)
 * ② `@vercel/blob/client` `upload()`(토큰은 같은 라우트가 그 키로만 발급). 실패하면 임시 업로드를 버리고 던진다.
 */
export async function uploadMemberDocumentFile(
  file: File,
  opts: { documentId?: string; onProgress?: (ratio: number) => void; signal?: AbortSignal } = {}
): Promise<string> {
  const prepared = await call<{
    target: { uploadId: string; pathname: string; mime: string; multipart: boolean }
  }>(UPLOADS, {
    method: 'POST',
    body: JSON.stringify({
      type: 'prepare',
      name: file.name,
      size: file.size,
      mime: file.type,
      ...(opts.documentId ? { documentId: opts.documentId } : {}),
    }),
  })
  const target = prepared.target
  try {
    await upload(target.pathname, file, {
      access: 'private',
      handleUploadUrl: UPLOADS,
      clientPayload: target.uploadId,
      contentType: target.mime,
      multipart: target.multipart,
      abortSignal: opts.signal,
      onUploadProgress: ({ loaded, total }) => opts.onProgress?.(total > 0 ? loaded / total : 0),
    })
  } catch (e) {
    void discardMemberDocumentUpload(target.uploadId).catch(() => undefined)
    throw new MemberDocumentApiError(0, uploadErrorMessage(e))
  }
  return target.uploadId
}

export function discardMemberDocumentUpload(uploadId: string): Promise<unknown> {
  return call(`${UPLOADS}/${uploadId}`, { method: 'DELETE' })
}

/** 임시 업로드 → 새 문서 v1 */
export function createMemberDocument(
  uploadId: string,
  source: 'upload' | 'editor' = 'upload'
): Promise<PromoteResponse> {
  return call(MEMBER_DOCUMENTS_API, { method: 'POST', body: JSON.stringify({ uploadId, source }) })
}

/** 임시 업로드 → 새 버전 */
export function addMemberDocumentVersion(
  documentId: string,
  input: { uploadId: string; source: 'upload' | 'editor'; baseVersionNo?: number | null }
): Promise<PromoteResponse> {
  return call(`${MEMBER_DOCUMENTS_API}/${documentId}/versions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function restoreMemberDocumentVersion(
  documentId: string,
  restoreVersionId: string
): Promise<PromoteResponse> {
  return call(`${MEMBER_DOCUMENTS_API}/${documentId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ restoreVersionId }),
  })
}

export function renameMemberDocument(documentId: string, name: string): Promise<{ name: string }> {
  return call(`${MEMBER_DOCUMENTS_API}/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteMemberDocument(documentId: string): Promise<unknown> {
  return call(`${MEMBER_DOCUMENTS_API}/${documentId}`, { method: 'DELETE' })
}

export function memberDocumentFileUrl(
  versionId: string,
  opts: { download?: boolean } = {}
): string {
  return `${MEMBER_DOCUMENT_FILE_API_BASE}/${versionId}${opts.download ? '?download=1' : ''}`
}

/** 바이트 수 → "1.2 MB" */
export function formatDocumentBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** ISO → "2026. 11. 4. 14:05"(KST) */
export function formatDocumentDate(iso: string): string {
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

/** 문서 형식 이름(목록의 '형식' 칸) */
export function documentTypeLabel(name: string): string {
  const i = name.lastIndexOf('.')
  const ext = i > 0 ? name.slice(i + 1).toLowerCase() : ''
  const labels: Record<string, string> = {
    pdf: 'PDF',
    hwp: '한글',
    hwpx: '한글(HWPX)',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',
    txt: '텍스트',
    md: '텍스트',
    csv: 'CSV',
    png: '이미지',
    jpg: '이미지',
    jpeg: '이미지',
    gif: '이미지',
    webp: '이미지',
  }
  return labels[ext] ?? (ext ? ext.toUpperCase() : '파일')
}

export function markEditorUsed(): void {
  try {
    window.localStorage.setItem(MEMBER_DOCUMENT_EDITOR_USED_KEY, '1')
  } catch {
    // 저장소를 못 쓰면 로그아웃 정리만 건너뛴다
  }
}
