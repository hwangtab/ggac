import { upload } from '@vercel/blob/client'
import type { BoardDocumentUploadTarget } from './uploadRules'
import { boardDocumentClientRejection } from './uploadRules'

/**
 * 이사회 서류 올리기(서류함 `DocumentUpload`·자료실 `BoardDocumentsPanel`)가 같이 쓰는 브라우저 전용 층.
 *
 * ① `/api/board-room/documents/uploads` 준비(서버가 키를 정한다) → ② `@vercel/blob/client` `upload()`로 비공개 저장소에
 * 직접(토큰은 같은 라우트가 그 키로만 발급) → ③ `/api/board-room/documents`에 JSON 으로 등록. 파일 바이트가 Vercel 함수를
 * 지나지 않아 4.5MB 본문 한도에 걸리지 않는다. 권한은 각 라우트가 요청마다 다시 판정한다.
 */

const DOCUMENTS_API = '/api/board-room/documents'
const UPLOADS_API = `${DOCUMENTS_API}/uploads`

export class BoardDocumentUploadError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'BoardDocumentUploadError'
  }
}

type Envelope<T> = { success?: boolean; data?: T; error?: string } | null

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new BoardDocumentUploadError(
      0,
      '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    )
  }
  const json = (await res.json().catch(() => null)) as Envelope<T>
  if (!res.ok || !json?.success) {
    throw new BoardDocumentUploadError(res.status, json?.error || fallback)
  }
  return json.data as T
}

function blobErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  if (name === 'BlobFileTooLargeError') return '파일 크기는 최대 50MB입니다.'
  if (name === 'BlobContentTypeNotAllowedError') return '이 형식으로는 올릴 수 없습니다.'
  if (name === 'BlobClientTokenExpiredError') return '업로드 시간이 지났습니다. 다시 올려 주세요.'
  if (name === 'AbortError' || name === 'BlobRequestAbortedError') return '올리기를 취소했습니다.'
  return '파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

/** 올리기 전에 브라우저에서 거른다(50MB·허용 형식). 문제가 없으면 null */
export function boardDocumentFileProblem(file: File): string | null {
  return boardDocumentClientRejection({ name: file.name, size: file.size, type: file.type })
}

/** 파일 하나를 올리고 서류로 등록한다. 실패하면 화면에 그대로 보여 줄 한국어 문구를 담아 던진다 */
export async function uploadBoardDocument(
  file: File,
  meta: { title: string; category: string; visibility: string },
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {}
): Promise<{ id: string }> {
  const problem = boardDocumentFileProblem(file)
  if (problem) throw new BoardDocumentUploadError(400, problem)

  const { target } = await postJson<{ target: BoardDocumentUploadTarget }>(
    UPLOADS_API,
    { type: 'prepare', name: file.name, size: file.size, mime: file.type },
    '업로드를 준비하지 못했습니다.'
  )

  try {
    await upload(target.pathname, file, {
      access: 'private',
      handleUploadUrl: UPLOADS_API,
      contentType: target.mime,
      multipart: target.multipart,
      abortSignal: opts.signal,
      onUploadProgress: ({ loaded, total }) => opts.onProgress?.(total > 0 ? loaded / total : 0),
    })
  } catch (e) {
    throw new BoardDocumentUploadError(0, blobErrorMessage(e))
  }

  return postJson<{ id: string }>(
    DOCUMENTS_API,
    {
      filePath: target.filePath,
      fileName: file.name,
      title: meta.title,
      category: meta.category,
      visibility: meta.visibility,
    },
    '서류 등록에 실패했습니다.'
  )
}
