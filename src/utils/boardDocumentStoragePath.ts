/**
 * @deprecated `@/lib/storage/boardDocuments`의 `isSafeBoardDocumentFilePath`를 쓴다.
 *
 * 예전 구현은 `file_path`가 `uploaded_by`로 시작할 것을 요구했는데, 시드로 들어온
 * 조합 문서 14건은 `uploaded_by = NULL`이라 전부 막혔다(2026-06-16 dcabad3 이후
 * 두 달간 다운로드 불가). 소유권은 DB 컬럼으로 검사하고 경로는 봉쇄만 본다.
 *
 * 이 래퍼는 남은 호출부가 없어질 때까지만 존재한다. `ownerId`는 무시된다.
 */
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'

export function isSafeBoardDocumentStoragePath(filePath: string, _ownerId: string): boolean {
  return isSafeBoardDocumentFilePath(filePath)
}
