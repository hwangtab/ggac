import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import { removeRenderCachesWith } from '@work/lib/files/cleanup-plan'
import { listObjectsPage, removeObjects } from '@work/lib/files/storage'
import { removeMemberDocumentObjects } from './storage'

/**
 * 탈퇴 확정 뒤(트랜잭션 커밋 뒤) 그 사람의 내 문서함 객체와 미리보기 캐시를 지운다 — 행은 `withdrawMember`가 이미 지웠다.
 * 경로는 그 사람의 폴더(`member-documents/<userId>/…`)인 것만 지운다. 던지지 않는다 — 실패하면 고아 객체가 남고 로그만 남긴다
 * (탈퇴 자체는 유효하다). 문서 이름·내용은 로그에 남기지 않는다.
 */
export async function removeWithdrawnMemberDocuments(
  userId: string,
  cleanup: { versionIds: string[]; blobPaths: string[] },
  onError: (stage: 'objects' | 'caches', error: unknown) => void
): Promise<void> {
  const paths = cleanup.blobPaths.filter(p => isMemberDocumentPathOf(p, userId))
  for (let i = 0; i < paths.length; i += 100) {
    try {
      await removeMemberDocumentObjects(paths.slice(i, i + 100))
    } catch (e) {
      onError('objects', e)
    }
  }
  await removeRenderCachesWith(cleanup.versionIds, {
    listPage: listObjectsPage,
    remove: removeObjects,
    onError: (_id, e) => onError('caches', e),
  })
}
