'use client'

import { useState } from 'react'
import Link from '@work/lib/nav/link'
import { useRouter } from '@work/lib/nav/navigation'
import {
  AppWindowIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  UploadIcon,
} from 'lucide-work'
import { Button, buttonVariants } from '@work/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { DOC_EDIT_MAX_BYTES, isDocEditFile, isFormFillFile } from '@work/lib/files/render-types'
import { canOfferHwpEdit } from '@work/lib/files/hwp-editor'
import type { CopyAsNewDocumentOutcome } from '@work/lib/files/create-rules'
import { canOfferOfficeEdit, getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import { markFinalVersion, releaseCheckout } from '@work/lib/files/version-actions'
import { checkoutHeldMessage, formatSinceLabel } from '@work/lib/files/version-rules'
import { cn } from '@work/lib/utils'
import CopyDocumentDialog from '../create-document/CopyDocumentDialog'
import DocumentEditDialog, { type DocEditMode } from '../doc-edit/DocumentEditDialog'
import { deleteEditBase, deleteEditHandle, notifyEditChanged } from './edit-handles'
import { useDesktopEditor } from '../office-edit/use-desktop-editor'
import OldVersionBanner from './OldVersionBanner'
import SaveVersionDialog from './SaveVersionDialog'
import { useBeginEdit, useUploadEdited } from './use-edit-flow'
import { useFileVersionState } from './use-file-version-state'
import VersionBadges from './VersionBadges'
import VersionConfirmDialog from './VersionConfirmDialog'
import VersionHistoryPanel from './VersionHistoryPanel'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 어디서 열어도 같은 버전 메뉴(docs/09 §3-1): 파일 상세(자료실·파일 탭 우측 패널)·미리보기 머리글·파일 탭 정보 줄이 쓴다.
 * 배지(v3·최신·최종·수정 중) + 버튼 최대 2개(내 PC에서 수정 / 수정본 올리기, 버전 기록) + ⋯ 메뉴(새 버전 올리기·최종 지정·수정 취소).
 * 편집 권한이 없으면(게스트·비멤버·보관 채널) 버전 기록 보기만. 상태는 서버 액션(listFileVersions)으로 읽는다.
 */
export default function FileVersionControls({
  attachmentId,
  fileName,
  className,
  withBanner = true,
  onOpenLatest,
  subdued = false,
}: {
  attachmentId: string
  fileName: string
  className?: string
  /** 옛 버전이면 "최신 버전이 있습니다" 띠를 위에 붙인다 */
  withBanner?: boolean
  onOpenLatest?: (attachmentId: string) => void
  /** 주 동작이 따로 있는 화면(파일 상세 — 미리보기가 주 버튼)에서는 "앱에서 편집"도 외곽선으로 낮춘다 */
  subdued?: boolean
}) {
  const router = useRouter()
  const { state } = useFileVersionState(attachmentId)
  const edit = useBeginEdit(state, fileName)
  const up = useUploadEdited(state?.rootId ?? null, state?.attachmentId ?? null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [docEdit, setDocEdit] = useState<DocEditMode | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copied, setCopied] = useState<{ name: string; href: string } | null>(null)
  const desktop = useDesktopEditor()

  if (!state) return null

  const mine = state.checkout?.mine === true
  const canRelease = state.checkout !== null && (mine || state.isAdmin) && state.canEdit
  const hasHistory = state.versions.length > 1
  const nextVersionNo = Math.max(0, ...state.versions.map(v => v.versionNo)) + 1
  const viewingOld = state.latestId !== null && state.latestId !== state.attachmentId
  const isFinal = state.finalId === state.attachmentId
  const showMenu = state.canEdit
  // 편집은 항상 최신본 기준이다 — 옛 버전을 보는 중이어도 그 내용에 고친 것을 얹어 최신본을 덮어쓰지 않게 한다
  const editTargetId = state.latestId ?? state.attachmentId
  const latestVersion = state.versions.find(v => v.id === editTargetId)
  const currentSize = state.versions.find(v => v.id === state.attachmentId)?.size ?? 0
  const editTargetName = latestVersion?.name ?? fileName
  const editTargetSize = latestVersion?.size ?? currentSize
  // HWP·HWPX 이고 20MB 이하면 앱 안에서 양식 채우기·문구 고치기(docs/10)
  const canDocEdit =
    state.canEdit && isDocEditFile(editTargetName) && editTargetSize <= DOC_EDIT_MAX_BYTES
  const latestLabel = viewingOld ? '최신본으로 ' : ''
  // Word·Excel·PPT 이고 50MB 이하·PC·편집기 env 가 있으면 앱 안 편집(docs/11) — 주 버튼이 "앱에서 편집"이 되고 "내 PC에서 수정"은 ⋯ 로 내려간다
  const officeEdit =
    state.canEdit &&
    desktop &&
    canOfferOfficeEdit({
      fileName: editTargetName,
      size: editTargetSize,
      origin: getOfficeEditorOrigin(),
    })
  // .hwp(·.hwpx 는 NEXT_PUBLIC_HWPX_EDITOR_ENABLED=1 까지) 이고 20MB 이하·PC·env(NEXT_PUBLIC_HWP_EDITOR_ENABLED=1 + 편집기 출처)면 앱 안 편집(docs/12·18) — 같은 자리의 주 버튼
  const hwpEdit =
    state.canEdit &&
    desktop &&
    canOfferHwpEdit({
      fileName: editTargetName,
      size: editTargetSize,
    })
  const appEdit = officeEdit || hwpEdit

  // 사본 만들기 성공 뒤 [열기] — 앱 편집 대상이면 편집 화면, 아니면 대화 안의 그 게시물
  function onCopied(outcome: CopyAsNewDocumentOutcome, messageId: string) {
    const openable =
      desktop &&
      (canOfferOfficeEdit({
        fileName: outcome.fileName,
        size: currentSize,
        origin: getOfficeEditorOrigin(),
      }) ||
        canOfferHwpEdit({ fileName: outcome.fileName, size: currentSize }))
    setCopied({
      name: outcome.fileName,
      href: openable
        ? `/edit/${outcome.attachmentId}`
        : `${outcome.conversationPath}#msg-${messageId}`,
    })
    router.refresh()
  }
  const message = note ?? edit.message ?? up.message

  async function cancelEdit() {
    if (!state) return
    setNote(null)
    try {
      const res = await releaseCheckout({ attachmentId: state.attachmentId })
      if (!res.ok) {
        setNote(res.error)
        return
      }
      await deleteEditHandle(state.rootId)
      deleteEditBase(state.rootId)
      notifyEditChanged()
      setNote('수정 중 표시를 해제했습니다.')
    } catch {
      setNote(NETWORK_ERROR)
    }
  }

  async function toggleFinal() {
    if (!state) return
    setNote(null)
    try {
      const res = isFinal
        ? await markFinalVersion({ rootAttachmentId: state.rootId, clear: true })
        : await markFinalVersion({ attachmentId: state.attachmentId })
      if (!res.ok) {
        setNote(res.error)
        return
      }
      notifyEditChanged()
      router.refresh()
    } catch {
      setNote(NETWORK_ERROR)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="file-version-controls">
      {withBanner && <OldVersionBanner state={state} onOpenLatest={onOpenLatest} />}
      <VersionBadges state={state} />

      <div className="flex flex-wrap items-center gap-2">
        {appEdit && (
          <Button
            type="button"
            size="sm"
            variant={subdued ? 'outline' : 'default'}
            onClick={() => router.push(`/edit/${editTargetId}`)}
          >
            <AppWindowIcon aria-hidden="true" />
            앱에서 편집
          </Button>
        )}
        {state.canEdit &&
          (mine ? (
            <Button type="button" size="sm" onClick={() => void up.start()}>
              <UploadIcon aria-hidden="true" />
              수정본 올리기
            </Button>
          ) : appEdit ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={edit.busy}
              onClick={() => void edit.begin()}
            >
              <PencilLineIcon aria-hidden="true" />
              {viewingOld ? '최신본으로 수정' : '내 PC에서 수정'}
            </Button>
          ))}
        {(hasHistory || state.canEdit) && (
          <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
            <HistoryIcon aria-hidden="true" />
            버전 기록
          </Button>
        )}
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${fileName} 버전 메뉴`}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              {mine && (
                <DropdownMenuItem onClick={() => void edit.begin()}>
                  {latestLabel}내 PC에서 다시 받기
                </DropdownMenuItem>
              )}
              {appEdit && !mine && (
                <DropdownMenuItem onClick={() => void edit.begin()}>
                  {latestLabel}내 PC에서 수정
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => up.startFresh(editTargetId)}>
                새 버전 올리기
              </DropdownMenuItem>
              {canDocEdit && (
                <>
                  {isFormFillFile(editTargetName) && (
                    <DropdownMenuItem onClick={() => setDocEdit('fill')}>
                      {latestLabel}양식 채우기
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setDocEdit('patch')}>
                    {latestLabel}문구 고치기
                  </DropdownMenuItem>
                </>
              )}
              {state.canCopy && (
                <DropdownMenuItem onClick={() => setCopyOpen(true)}>사본 만들기</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void toggleFinal()}>
                {isFinal ? '최종 지정 해제' : '최종으로 지정'}
              </DropdownMenuItem>
              {canRelease && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void cancelEdit()}>
                    {mine ? '수정 취소' : '수정 중 표시 해제'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </span>

      {copied && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
          ‘{copied.name}’ 사본을 만들었습니다
          <Link href={copied.href} className={buttonVariants({ size: 'xs', variant: 'outline' })}>
            열기
          </Link>
        </p>
      )}

      {state.canCopy && (
        <CopyDocumentDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          sourceAttachmentId={state.attachmentId}
          sourceName={fileName}
          onCopied={onCopied}
        />
      )}

      <VersionHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} state={state} />

      {docEdit && (
        <DocumentEditDialog
          open
          onOpenChange={next => !next && setDocEdit(null)}
          mode={docEdit}
          attachmentId={editTargetId}
          fileName={editTargetName}
          onSaved={() => {
            notifyEditChanged()
            router.refresh()
          }}
          onUseLocalEdit={() => {
            setDocEdit(null)
            void edit.begin()
          }}
        />
      )}

      <VersionConfirmDialog
        open={edit.held !== null}
        title="다른 사람이 수정 중입니다"
        description={`${checkoutHeldMessage(edit.held?.heldByName ?? null, edit.held ? formatSinceLabel(edit.held.since) : '')} 그래도 받을까요?`}
        confirmLabel="그래도 받기"
        onCancel={edit.cancelHeld}
        onConfirm={() => void edit.confirmHeld()}
      />

      {state.canEdit && (
        <SaveVersionDialog
          open={up.dialog.open}
          onOpenChange={up.setOpen}
          channelId={state.channelId}
          baseAttachmentId={up.dialog.baseAttachmentId}
          fileName={fileName}
          nextVersionNo={nextVersionNo}
          initialFile={up.dialog.file}
          onSaved={async () => {
            await up.afterSaved()
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
