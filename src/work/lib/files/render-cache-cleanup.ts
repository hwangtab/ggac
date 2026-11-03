import { removeRenderCachesWith } from './cleanup-plan'
import { listObjectsPage, removeObjects } from './storage'

/**
 * 이사회 서류의 미리보기 캐시 정리 — 서버 전용. 자료실 미리보기(`/api/board-room/work/board-documents/<id>/render`)는
 * 서류 원본을 변환한 결과를 업무툴 캐시(`board-work/renders/<서류 id>-…`)에 둔다. 서류 삭제
 * (`/api/board-room/documents/<id>` DELETE)가 행과 원본을 지운 **뒤에** 부른다.
 *
 * 업무툴 저장소 계층(`storage.ts` — 목록 접두 제한, 지우기 직전 `isSafeBoardWorkPath`)만 쓰고, 지우는 키는
 * `removeRenderCachesWith`가 `<서류 id>-`로 시작하는 `board-work/renders/` 키로 거른 것뿐이다(서류 원본
 * `board-documents/…`·다른 id 의 캐시는 건드리지 않는다). 던지지 않는다 — 실패는 `onError`로 알리고 지운 수를 돌려준다.
 */
export async function removeBoardDocumentRenderCache(
  documentId: string,
  onError: (error: unknown) => void
): Promise<number> {
  return removeRenderCachesWith([documentId], {
    listPage: listObjectsPage,
    remove: removeObjects,
    onError: (_id, e) => onError(e),
  })
}
