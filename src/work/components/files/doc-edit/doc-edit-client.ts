import type {
  DraftOutcome,
  DraftRequest,
  EditableBlocks,
  FormSchemaInfo,
} from '@work/lib/files/doc-edit-types'

/** 문서 편집 Route Handler 호출(브라우저). 응답 본문은 JSON(칸·블록·요약)뿐 — 파일 바이트는 오가지 않는다 */

export class DocEditHttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'DocEditHttpError'
    this.status = status
    this.code = code
  }
}

const NETWORK_MESSAGE = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new DocEditHttpError(0, 'network', NETWORK_MESSAGE)
  }
  if (!res.ok) {
    let code = 'server'
    let message = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      // 본문이 JSON 이 아니면(함수 시간 초과 시 플랫폼이 HTML 로 응답) 기본 문구
      if (res.status === 504 || res.status === 502 || res.status === 503) {
        code = 'timeout'
        message = '문서 처리에 시간이 너무 오래 걸려 중단됐습니다. 내 PC에서 수정을 써 주세요.'
      }
    }
    throw new DocEditHttpError(res.status, code, message)
  }
  return (await res.json()) as T
}

export const fetchFormSchema = (attachmentId: string) =>
  request<FormSchemaInfo>(`/api/board-room/work/files/${attachmentId}/form`)

export const fetchEditableBlocks = (attachmentId: string) =>
  request<EditableBlocks>(`/api/board-room/work/files/${attachmentId}/blocks`)

/** HWP 앱 안 편집(docs/12) 저장본 서버 검증 — 올려 둔 임시 업로드를 kordoc 으로 보고 결과를 초안 메타에 남긴다 */
export const verifyHwpSave = (attachmentId: string, uploadId: string) =>
  request<DraftOutcome>(`/api/board-room/work/files/${attachmentId}/drafts/${uploadId}/verify`, {
    method: 'POST',
  })

export const requestDraft = (attachmentId: string, body: DraftRequest) =>
  request<DraftOutcome>(`/api/board-room/work/files/${attachmentId}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** 새 한글 문서(docs/18) 첫 저장본 서버 검증 — 원본 없이 형식·재파싱만 본다. 새 문서는 이어붙일 위치(스레드)를 같이 보낸다 */
export const verifyNewHwpxSave = (uploadId: string, parentId: string | null) =>
  request<DraftOutcome>(`/api/board-room/work/files/new-drafts/${uploadId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  })
