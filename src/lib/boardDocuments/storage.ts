import { list } from '@vercel/blob'
import {
  blobPathForBoardDocument,
  boardDocumentVersionsBlobPrefix,
  isBoardDocumentVersionBlobPathOf,
  isSafeBoardDocumentBlobPath,
} from '@/lib/storage/boardDocuments'
import {
  createGuardedPrivateStore,
  privateStoreToken,
  StorageUnconfiguredError,
} from '@work/lib/files/private-store'
import { StorageUnavailableError } from '@work/lib/files/storage-errors'

/**
 * 이사회 서류 앱 편집의 저장소 계층(비공개 Blob, 서버 전용) — docs/board-work/05-이사회-서류-앱-편집.md §3.
 *
 * 업무툴·내 문서함과 같은 공장 함수(`createGuardedPrivateStore`)를 **`isSafeBoardDocumentBlobPath`** 판정으로 한 벌
 * 만든다. 그래서 여기의 읽기·메타·복사·삭제는 `board-documents/<안전한 file_path>` 밖(`backups/`·`mailbox/`·
 * `board-work/`·`member-documents/`)에 닿지 못한다. **권한을 판단하지 않는다** — 라우트가 `requireBoardMember()` →
 * 서류 행 → 편집 권한을 끝낸 행의 경로만 넘긴다.
 *
 * 토큰은 업무툴과 같은 `privateStoreToken()`이다 — `BOARD_WORK_BLOB_READ_WRITE_TOKEN`이 정의돼 있으면(빈 값 포함) 그것만,
 * 아니면 `PRIVATE_BLOB_READ_WRITE_TOKEN`. 기존 서류함(`privateProvider.ts`)은 늘 `PRIVATE_BLOB_READ_WRITE_TOKEN`을 쓰므로
 * **운영에서는 두 토큰이 같은 저장소를 가리켜야 한다**(지금 운영에는 앞의 변수가 없어 같은 값이다 — 05 §3-2). E2E 는
 * 앞의 변수를 늘 정의해(시험 저장소 토큰 또는 빈 값) 운영 저장소에 닿지 않는다(빈 값이면 503).
 */
const store = createGuardedPrivateStore(isSafeBoardDocumentBlobPath)

/** `file_path`(접두 없는 값) → 저장소 pathname. 규약 밖이면 던진다(`blobPathForBoardDocument`) */
export function boardDocumentObjectPath(filePath: string): string {
  return blobPathForBoardDocument(filePath)
}

export const readBoardDocumentObject = store.readObject
export const statBoardDocumentObject = store.statObject
export const downloadBoardDocumentObject = store.downloadObject
export const copyBoardDocumentObject = store.copyObject
export const removeBoardDocumentObjects = store.removeObjects

/** 저장소가 설정돼 있는가(업로드 준비 단계에서 미리 거절할 때) */
export function hasBoardDocumentEditStore(): boolean {
  return privateStoreToken() !== null
}

/** 브라우저 직접 업로드 토큰 발급(`handleUpload({ token })`)에 쓰는 저장소 토큰. 없으면 null */
export function boardDocumentEditStoreToken(): string | null {
  return privateStoreToken()
}

/**
 * 이 서류의 버전 파일 객체(`board-documents/versions/<서류 id>/…`) 전부 — 행 없이 남은 저장본(승격 전에 끊긴 업로드)까지
 * 서류 삭제 때 함께 지우려고 나열한다. 접두는 서류 id 로만 만들고, 돌려받은 키도 그 서류의 버전 경로인지 다시 본다.
 * 저장소 미설정은 StorageUnconfiguredError, 그 밖의 오류는 StorageUnavailableError.
 */
export async function listBoardDocumentVersionObjects(documentId: string): Promise<string[]> {
  const prefix = boardDocumentVersionsBlobPrefix(documentId)
  if (!prefix) return []
  const token = privateStoreToken()
  if (!token) throw new StorageUnconfiguredError()
  const out: string[] = []
  let cursor: string | undefined
  // 한 서류의 버전이 수천 개가 될 일은 없지만, 끝없이 돌지 않게 쪽 수를 묶는다
  for (let page = 0; page < 20; page++) {
    let res: Awaited<ReturnType<typeof list>>
    try {
      res = await list({ prefix, cursor, limit: 1000, token })
    } catch (e) {
      throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
    }
    for (const b of res.blobs) {
      if (isBoardDocumentVersionBlobPathOf(b.pathname, documentId)) out.push(b.pathname)
    }
    if (!res.hasMore || !res.cursor) break
    cursor = res.cursor
  }
  return out
}

/** 서류 객체의 공통 접두 — 고아 청소(`./orphans.ts`)가 이 아래만 훑는다 */
export const BOARD_DOCUMENTS_LIST_PREFIX = 'board-documents/'

/**
 * 서류 객체 한 페이지(고아 청소용 — `board-documents/` 아래만). 저장소가 없으면 빈 페이지. 봉쇄 판정
 * (`isSafeBoardDocumentBlobPath`)을 지나지 못한 키는 결과에서 뺀다(지울 후보가 되지 않게).
 *
 * 토큰은 이 파일의 다른 함수와 같은 `privateStoreToken()`이다 — 행 없는 객체를 만드는 두 경로(브라우저 직접 업로드
 * `/documents/uploads`, 앱 편집 저장본 `/[id]/edit-uploads`)가 모두 이 토큰으로 발급한 업로드 토큰으로 쓰고, 지우는
 * `removeBoardDocumentObjects`도 같은 토큰이다. 예전 multipart 경로(`privateProvider.ts`)는 `PRIVATE_BLOB_READ_WRITE_TOKEN`
 * 으로 쓰지만 서버가 객체와 행을 함께 만들고 실패하면 객체를 되돌린다. 운영은 두 토큰이 같은 저장소라(위 머리 주석) 한 번
 * 훑으면 전부 본다. 두 토큰이 다른 환경(E2E·시험 — `BOARD_WORK_BLOB_READ_WRITE_TOKEN`이 시험 저장소)에서는
 * **일부러 `PRIVATE_BLOB_READ_WRITE_TOKEN` 쪽을 훑지 않는다** — 그 저장소가 이 DB 와 같은 환경이라는 보장이 없다.
 */
export async function listBoardDocumentObjectsPage(cursor?: string): Promise<{
  objects: { pathname: string; uploadedAt: Date }[]
  cursor: string | null
  hasMore: boolean
}> {
  const token = privateStoreToken()
  if (!token) return { objects: [], cursor: null, hasMore: false }
  const res = await list({ prefix: BOARD_DOCUMENTS_LIST_PREFIX, cursor, limit: 1000, token })
  return {
    objects: res.blobs
      .filter(b => isSafeBoardDocumentBlobPath(b.pathname))
      .map(b => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })),
    cursor: res.cursor ?? null,
    hasMore: res.hasMore,
  }
}
