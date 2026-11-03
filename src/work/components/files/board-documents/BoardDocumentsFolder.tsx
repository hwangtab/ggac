import { FolderLockIcon } from 'lucide-work'
import { listDocuments } from '@/db/queries/board'
import { getDisplayNames } from '@/db/queries/work/directory'
import { visibilityScopeFor } from '@/lib/server/boardRoomAuth'
import { isWorkAdminRole, type WorkGuardContext } from '@/lib/server/boardWorkAuth'
import { PageBody, PageHeader } from '@work/components/layout/page'
import { canUploadToBoardFolder } from '@work/lib/files/board-folders'
import BoardDocumentsPanel, { type BoardDocumentItem } from './BoardDocumentsPanel'
import BoardFolderNav from './BoardFolderNav'

/**
 * 자료실 '이사회 서류' 폴더 하나(03 §10 — 서류함 통합 (가)). `/board-room/files?board=<분류>`.
 *
 * 서류는 옮기지 않았다 — `board_documents`를 기존 서류함과 같은 조회(`listDocuments`)로 읽는다. 호출부(자료실 페이지)가
 * `requireWorkStaff()`를 지났으므로 이사·감사·관리자다 → 열람 범위는 `visibilityScopeFor(true)`(이사회만 + 조합원 공개).
 * 올리기·지우기는 기존 API(`/api/board-room/documents` POST·DELETE)를 그대로 부른다 — 검증·속도 제한·권한 판정이 그쪽에
 * 있다. 단추를 보일지는 기존 화면 규칙(올린 사람 또는 관리자만 지우기, 정기총회는 관리자만 올리기)을 따른다.
 */
export default async function BoardDocumentsFolder({
  ctx,
  category,
  openDocId,
}: {
  ctx: WorkGuardContext
  category: string
  openDocId: string | null
}) {
  const rows = await listDocuments({ category, visibility: visibilityScopeFor(true) })
  const names = await getDisplayNames(
    rows.map(r => r.uploaded_by).filter((v): v is string => Boolean(v))
  )
  const isAdmin = isWorkAdminRole(ctx.staff.role)
  const items: BoardDocumentItem[] = rows.map(r => ({
    id: r.id,
    title: r.title,
    fileName: r.file_name?.trim() || r.title,
    size: r.file_size ?? 0,
    mime: r.mime_type ?? '',
    visibility: r.visibility,
    uploaderId: r.uploaded_by,
    uploaderName: r.uploaded_by ? (names.get(r.uploaded_by) ?? '이름 없음') : '-',
    createdAt: r.created_at,
  }))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="board-work-board-documents">
      <PageHeader
        title={`이사회 서류 · ${category}`}
        icon={FolderLockIcon}
        subtitle={`${items.length.toLocaleString('ko-KR')}개`}
      />
      <PageBody width="wide" innerClassName="space-y-4">
        <BoardFolderNav active={category} />
        <BoardDocumentsPanel
          category={category}
          items={items}
          meId={ctx.user.id}
          isAdmin={isAdmin}
          canUpload={canUploadToBoardFolder(category, isAdmin)}
          openDocId={openDocId && items.some(i => i.id === openDocId) ? openDocId : null}
        />
      </PageBody>
    </div>
  )
}
