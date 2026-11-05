import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { StorageUnconfiguredError } from '@work/lib/files/private-store'
import {
  boardDocumentObjectPath,
  listBoardDocumentVersionObjects,
  removeBoardDocumentObjects,
} from './storage'

/**
 * 서류 삭제 때 앱 편집 버전 파일을 지운다(docs/board-work/05-이사회-서류-앱-편집.md §6) — 서버 전용, 던지지 않는다.
 *
 * 삭제 라우트(`/api/board-room/documents/[id]` DELETE)가 **행을 지운 뒤에** 부른다(기존 순서와 근거 그대로: 행이 먼저
 * 사라지면 최악이 "저장소에만 남은 고아 객체"라 화면이 깨지지 않는다). 지우는 것:
 *  - 버전 행에 있던 경로 전부(v1 의 옛 경로 `<올린 사람>/<파일>` 포함). 지금 파일(`currentPath`)은 라우트가 이미 지웠다.
 *  - `board-documents/versions/<서류 id>/` 아래 객체 전부 — 승격 전에 끊긴 저장본(행 없는 객체)까지.
 * 봉쇄 판정을 지나지 못한 경로는 지우지 않고 알린다(같은 저장소에 DB 백업이 있다). 저장소가 설정되지 않은 배포(시험)는
 * 지울 객체도 없으므로 조용히 끝낸다. 지운 객체 수를 돌려준다.
 */
export async function removeBoardDocumentVersionFiles(
  documentId: string,
  versionPaths: readonly string[],
  currentPath: string,
  onError: (error: unknown) => void
): Promise<number> {
  const targets = new Set<string>()
  for (const p of versionPaths) {
    if (p === currentPath) continue
    if (!isSafeBoardDocumentFilePath(p)) {
      onError(new Error('안전하지 않은 버전 경로를 건너뛰었다'))
      continue
    }
    targets.add(boardDocumentObjectPath(p))
  }
  try {
    for (const p of await listBoardDocumentVersionObjects(documentId)) targets.add(p)
  } catch (e) {
    if (e instanceof StorageUnconfiguredError) return 0
    onError(e)
  }
  if (targets.size === 0) return 0
  try {
    await removeBoardDocumentObjects([...targets])
    return targets.size
  } catch (e) {
    if (!(e instanceof StorageUnconfiguredError)) onError(e)
    return 0
  }
}
