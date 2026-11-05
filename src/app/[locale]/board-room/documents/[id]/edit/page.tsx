import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ShieldAlertIcon } from 'lucide-work'
import {
  getBoardDocumentForEdit,
  latestRecordedVersionNo,
} from '@/db/queries/boardDocumentVersions'
import { boardDocumentEditAccess, currentFileName } from '@/lib/boardDocuments/editRules'
import { isWorkAdminRole, requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isUuid } from '@/lib/server/boardDocumentEditRoute'
import { EmptyState } from '@work/components/layout/page'
import { buttonVariants } from '@work/components/ui/button'
import { resolveAppEditor } from '@work/lib/files/app-edit'
import { Link } from '@/i18n/navigation'
import BoardDocumentEditScreen from './BoardDocumentEditScreen'

export const metadata: Metadata = { title: '서류 편집' }
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function Unavailable({ id, message }: { id: string; message: string }) {
  return (
    <div className="flex h-full flex-col" data-testid="board-document-edit-denied">
      <EmptyState icon={ShieldAlertIcon} as="h1" title={message}>
        <Link href={`/board-room/documents/${id}`} className={buttonVariants({ size: 'sm' })}>
          서류로 돌아가기
        </Link>
      </EmptyState>
    </div>
  )
}

/**
 * `/board-room/documents/[id]/edit` — 이사회 서류 앱 편집(docs/board-work/05-이사회-서류-앱-편집.md §1·§7). 최신 버전을
 * 업무툴과 같은 편집기(오피스 iframe·rhwp)로 연다. 없는 서류는 404, 고칠 수 없는 사람(올린 사람·관리자가 아님)은 안내,
 * 편집기 env 가 없거나 형식·크기가 맞지 않으면 안내. 실제 차단은 저장 라우트(`/api/board-room/documents/<id>/…`)가 다시 한다.
 */
export default async function BoardDocumentEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireWorkStaff()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const doc = await getBoardDocumentForEdit(id)
  const access = boardDocumentEditAccess(doc, ctx.user.id, isWorkAdminRole(ctx.staff.role))
  if (access === 'not_found') notFound()
  if (access === 'forbidden') {
    return (
      <Unavailable
        id={id}
        message="이 서류를 고칠 권한이 없습니다. 올린 사람이나 관리자만 고칠 수 있습니다."
      />
    )
  }
  const name = currentFileName(doc)
  const resolved = resolveAppEditor(name, doc.fileSize ?? 0)
  if (!resolved.editor) return <Unavailable id={id} message={resolved.message} />
  const versionNo = (await latestRecordedVersionNo(id)) ?? 1

  return (
    <BoardDocumentEditScreen
      documentId={id}
      editor={resolved.editor}
      fileName={name}
      versionNo={versionNo}
      hasBody={Boolean(doc.bodyMarkdown && doc.bodyMarkdown.trim())}
    />
  )
}
