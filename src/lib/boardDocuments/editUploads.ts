import { z } from 'zod'
import type { BoardDocumentEditRow } from '@/db/queries/boardDocumentVersions'
import {
  boardDocumentVersionFilePath,
  isBoardDocumentVersionBlobPathOf,
} from '@/lib/storage/boardDocuments'
import { canOfferAppEdit } from '@work/lib/files/app-edit'
import { hwpEditFormatOf } from '@work/lib/files/hwp-editor'
import { resolveMime } from '@work/lib/files/mime'
import { OFFICE_EDIT_MAX_BYTES } from '@work/lib/files/office-edit'
import { sanitizeFileName } from '@work/lib/files/paths'
import { DOC_EDIT_MAX_BYTES } from '@work/lib/files/render-types'
import { currentFileName, isCompatibleSavedName, savedDisplayName } from './editRules'
import { boardDocumentObjectPath, hasBoardDocumentEditStore } from './storage'

/**
 * 이사회 서류 앱 편집 — 저장본 업로드 준비(①)와 업로드 토큰 판정(②). `versions.ts`에서 떼어 냈다: 그 모듈은 HWP·HWPX
 * 저장본 검사·웹 본문 다시 만들기로 kordoc 을 끌어오는데, `/edit-uploads` 라우트가 그 모듈을 import 하자 함수 번들이
 * 400MB(한도 250MB)로 커져 배포가 실패했다(2026-11-05 Vercel 실측). **이 파일은 kordoc 을 부르는 모듈을 import 하지 않는다.**
 */

export type ServiceResult<T> = { ok: boolean; data?: T; status?: number; error?: string }

export function fail<T>(status: number, error: string): ServiceResult<T> {
  return { ok: false, status, error }
}

export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
export const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** 저장본의 크기 상한 — HWP·HWPX 20MB(업무툴 DOC_EDIT_MAX_BYTES), 오피스 50MB(OFFICE_EDIT_MAX_BYTES) */
export function maxBytesFor(name: string): number {
  return hwpEditFormatOf(name) ? DOC_EDIT_MAX_BYTES : OFFICE_EDIT_MAX_BYTES
}

/** 앱에서 고칠 수 있는 서류인가(이 배포의 편집기 env·형식·크기) — 업로드 준비와 저장이 같은 판정을 쓴다 */
export function editableHere(doc: BoardDocumentEditRow): boolean {
  return canOfferAppEdit(currentFileName(doc), doc.fileSize ?? 0)
}

/** 저장본 키: `versions/<서류>/<업로드 id>/<ASCII 안전 이름>`(file_path 칸 값). 이름은 지금 이름 본체 + 저장본 확장자 */
export function savedFilePath(doc: BoardDocumentEditRow, uploadId: string, savedName: string) {
  const name = savedDisplayName(currentFileName(doc), savedName)
  const filePath = boardDocumentVersionFilePath(doc.id, uploadId, sanitizeFileName(name))
  return { name, filePath }
}

export type EditUploadTarget = {
  uploadId: string
  pathname: string
  mime: string
  multipart: boolean
}

const prepareSchema = z.object({
  type: z.literal('prepare'),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1),
})

/**
 * ① 저장본 업로드 준비 — 이 배포에서 앱 편집할 수 있는 서류인지, 저장본 이름이 같은 형식인지, 크기가 편집기 상한 안인지를
 * 보고 키를 정한다. 임시 업로드 행을 두지 않는다: 키가 `versions/<이 서류>/<새 uuid>/…`로 서버가 정한 모양이라, 토큰
 * 발급(②)과 승격(③)이 같은 판정을 다시 할 수 있다(05 §3-3).
 */
export function prepareEditUpload(
  doc: BoardDocumentEditRow,
  body: unknown
): ServiceResult<EditUploadTarget> {
  const parsed = prepareSchema.safeParse(body)
  if (!parsed.success) return fail(400, '파일 정보가 올바르지 않습니다.')
  if (!editableHere(doc))
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식이거나 너무 큽니다.')
  const current = currentFileName(doc)
  if (!isCompatibleSavedName(current, parsed.data.name)) {
    return fail(415, '원본과 같은 형식으로만 저장할 수 있습니다.')
  }
  if (parsed.data.size > maxBytesFor(current)) {
    return fail(
      413,
      hwpEditFormatOf(current) ? '파일이 20MB를 넘습니다.' : '파일이 50MB를 넘습니다.'
    )
  }
  if (!hasBoardDocumentEditStore()) return fail(503, '파일 저장소가 설정되지 않았습니다.')
  const uploadId = crypto.randomUUID()
  const { name, filePath } = savedFilePath(doc, uploadId, parsed.data.name)
  if (!filePath) return fail(400, '파일 정보가 올바르지 않습니다.')
  return {
    ok: true,
    data: {
      uploadId,
      pathname: boardDocumentObjectPath(filePath),
      mime: resolveMime('', name),
      multipart: parsed.data.size > MULTIPART_THRESHOLD_BYTES,
    },
  }
}

/**
 * ② 업로드 토큰 판정 — 브라우저가 보낸 pathname 이 **이 서류의 버전 키**이고 업로드 id 구간이 `clientPayload`와 같으며
 * 형식이 원본과 맞을 때만. 토큰은 그 형식 하나·편집기 상한까지(덮어쓰기·무작위 접미사 없이 — 라우트가 끈다).
 */
export function decideEditUploadToken(
  doc: BoardDocumentEditRow,
  uploadId: string,
  pathname: string
): ServiceResult<{ allowedContentTypes: string[]; maximumSizeInBytes: number }> {
  if (!editableHere(doc))
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식이거나 너무 큽니다.')
  if (!isBoardDocumentVersionBlobPathOf(pathname, doc.id)) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  const segments = pathname.split('/')
  // board-documents / versions / <서류> / <업로드 id> / <이름>
  if (segments[3]?.toLowerCase() !== uploadId.toLowerCase()) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  const fileSegment = segments[4] ?? ''
  const current = currentFileName(doc)
  if (!isCompatibleSavedName(current, fileSegment)) {
    return fail(403, '원본과 같은 형식으로만 저장할 수 있습니다.')
  }
  return {
    ok: true,
    data: {
      allowedContentTypes: [resolveMime('', fileSegment)],
      maximumSizeInBytes: maxBytesFor(current),
    },
  }
}
