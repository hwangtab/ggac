import { list } from '@vercel/blob'
import { isSafeMemberDocumentPath } from '@/lib/storage/memberDocuments'
import { createGuardedPrivateStore, privateStoreToken } from '@work/lib/files/private-store'

/**
 * 조합원 내 문서함 저장소(비공개 Blob, 서버 전용) — docs/board-work/04-조합원-문서함.md §3.
 *
 * 업무툴 저장소와 같은 계층(`createGuardedPrivateStore`)을 **`isSafeMemberDocumentPath`** 판정으로 한 벌 만든다. 그래서
 * 문서함의 어떤 읽기·쓰기·삭제·복사도 `member-documents/<uuid>/<uuid>/<안전 이름>` 밖(`backups/`·`mailbox/`·
 * `board-documents/`·`board-work/`)에 닿지 못한다. **권한을 판단하지 않는다** — 라우트가 `requireActiveMember()` →
 * 스위치 → 소유 판정을 끝낸 행의 경로만 넘긴다.
 *
 * 토큰은 업무툴과 같다(`privateStoreToken`) — E2E는 `BOARD_WORK_BLOB_READ_WRITE_TOKEN`을 늘 정의해(시험 저장소 토큰
 * 또는 빈 값) 운영 저장소에 닿지 않는다.
 */
const store = createGuardedPrivateStore(isSafeMemberDocumentPath)

export const readMemberDocumentObject = store.readObject
export const statMemberDocumentObject = store.statObject
export const downloadMemberDocumentObject = store.downloadObject
export const removeMemberDocumentObjects = store.removeObjects
export const copyMemberDocumentObject = store.copyObject

/** 문서함 저장소가 설정돼 있는가(업로드 준비 단계에서 미리 거절할 때) */
export function hasMemberDocumentStore(): boolean {
  return privateStoreToken() !== null
}

/** 저장소 토큰(업로드 토큰 발급 `handleUpload({ token })` — 명시하지 않으면 SDK 가 `BLOB_READ_WRITE_TOKEN`으로 떨어진다) */
export function memberDocumentStoreToken(): string | null {
  return privateStoreToken()
}

/** 문서함 객체의 공통 접두 — 고아 청소가 이 아래만 훑는다 */
export const MEMBER_DOCUMENTS_LIST_PREFIX = 'member-documents/'

/**
 * 문서함 객체 한 페이지(고아 청소용 — `member-documents/` 아래만). 저장소가 없으면 빈 페이지. 경로 판정을 지나지 못한 키는
 * 결과에서 뺀다(지울 후보가 되지 않게).
 */
export async function listMemberDocumentObjectsPage(cursor?: string): Promise<{
  objects: { pathname: string; uploadedAt: Date }[]
  cursor: string | null
  hasMore: boolean
}> {
  const token = privateStoreToken()
  if (!token) return { objects: [], cursor: null, hasMore: false }
  const res = await list({ prefix: MEMBER_DOCUMENTS_LIST_PREFIX, cursor, limit: 1000, token })
  return {
    objects: res.blobs
      .filter(b => isSafeMemberDocumentPath(b.pathname))
      .map(b => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })),
    cursor: res.cursor ?? null,
    hasMore: res.hasMore,
  }
}
