'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { ArrowLeftIcon, InfoIcon, SaveIcon } from 'lucide-work'
import { Badge } from '@work/components/ui/badge'
import { Button } from '@work/components/ui/button'
import { EmptyState, NoticeBanner } from '@work/components/layout/page'
import { checkoutFile } from '@work/lib/files/version-actions'
import { officeExtensionWillChange } from '@work/lib/files/office-edit'
import { checkoutHeldMessage, formatSinceLabel, versionLabel } from '@work/lib/files/version-rules'
import {
  createTypeInfo,
  type CreateDocumentOutcome,
  type OfficeCreateType,
} from '@work/lib/files/create-rules'
import { fileUrl } from '../FilePreviewBody'
import FirstSaveDialog from '../create-document/FirstSaveDialog'
import SaveVersionDialog from '../versions/SaveVersionDialog'
import VersionConfirmDialog from '../versions/VersionConfirmDialog'
import { notifyEditChanged } from '../versions/edit-handles'
import { useEditCheckout, useLeaveGuard } from './use-edit-checkout'
import OfficeEditorFrame, {
  type OfficeEditorHandle,
  type OfficeEditorPhase,
} from './OfficeEditorFrame'

export const OFFICE_INFO_TEXT =
  '글꼴이 원본과 다르게 보일 수 있어요 · 한 번에 한 사람만 편집할 수 있어요 · 최종본은 Word 등에서 한 번 확인해 주세요'

/**
 * 오피스 앱 편집 전용 화면(docs/11 §2-2) — 앱 셸 밖. 머리줄(← 돌아가기 · 파일 이름 · 버전 · 상태 · 저장 · 안내) + 편집기 iframe.
 * 들어오면 checkoutFile(남이 잡고 있으면 확인), 나가면 releaseCheckout. 저장은 1단계 업로드 → saveFileVersion(SaveVersionDialog, 충돌 안내 그대로).
 */
/** 새 문서(docs/16) — 기준 버전 없이 빈 서식으로 열고, 첫 저장 때 파일(v1)을 만든다 */
export type NewDocumentInfo = {
  type: OfficeCreateType
  folderPath: string | null
  /** 스레드 안에서 만들면 그 스레드 루트 메시지 id */
  parentId: string | null
  /** 돌아갈 대화 경로(폴더가 있으면 파일 탭 `?path=`) */
  backHref: string
  /** 첫 저장 때 만들 게시물 id(주소 `id`). 없으면 화면이 새로 정한다 */
  messageId?: string
  /** 이 주소로 이미 만든 문서(새로고침 등) — 처음 그릴 때만 그 편집 화면으로 옮긴다 */
  createdAttachmentId?: string | null
}

export default function OfficeEditScreen({
  attachmentId,
  fileName,
  channelId,
  versionNo,
  nextVersionNo,
  origin,
  parentOrigin,
  newDocument,
}: {
  /** 새 문서(newDocument)이면 null */
  attachmentId: string | null
  fileName: string
  channelId: string
  versionNo: number
  nextVersionNo: number
  origin: string
  parentOrigin?: string
  newDocument?: NewDocumentInfo
}) {
  const router = useRouter()
  const editor = useRef<OfficeEditorHandle>(null)
  const { gate, setGate, enter, baseRef, adopt } = useEditCheckout(attachmentId)
  const isNew = attachmentId === null
  const [phase, setPhase] = useState<OfficeEditorPhase>('loading')
  // 편집기가 알리는 변경 표시. 편집기는 `document:save` 로 파일을 내보낸 순간 스스로 변경 표시를 지우므로,
  // 내보낸 파일이 서버에 새 버전으로 올라가기 전(대화상자 취소·실패 포함)에는 따로 `exportPending` 으로 "저장 안 됨"을 유지한다.
  const [editorDirty, setEditorDirty] = useState(false)
  const [exportPending, setExportPending] = useState(false)
  const exportedDirty = useRef(false)
  const dirty = editorDirty || exportPending
  const setDirty = useCallback((next: boolean) => {
    setEditorDirty(next)
    if (!next) setExportPending(false)
  }, [])
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 저장이 끝나면 다음 저장의 기준 버전·표시 번호가 바뀐다
  const [baseId, setBaseId] = useState(attachmentId)
  // 새 문서의 게시물 id — 첫 저장 재시도가 같은 id 를 써서 두 번 만들지 않는다
  const [messageId] = useState(() => newDocument?.messageId ?? crypto.randomUUID())
  const [shownNo, setShownNo] = useState(versionNo)
  const [savedNo, setSavedNo] = useState<number | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [confirmExt, setConfirmExt] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  useLeaveGuard(dirty)

  // 처음 그릴 때의 값만 본다 — 첫 저장 직후 서버 액션이 페이지를 다시 그리면 이 값이 채워져 오지만 그때는 옮기지 않는다
  const [alreadyCreated] = useState(() => newDocument?.createdAttachmentId ?? null)
  useEffect(() => {
    if (alreadyCreated) router.replace(`/edit/${alreadyCreated}`)
  }, [alreadyCreated, router])

  const templateType = newDocument?.type
  const loadBuffer = useCallback(async () => {
    const url = attachmentId
      ? fileUrl(attachmentId, { download: true })
      : createTypeInfo(templateType ?? 'docx').templatePath
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.arrayBuffer()
  }, [attachmentId, templateType])

  const backHref = newDocument?.backHref
  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back()
    else router.push(backHref ?? '/files')
  }, [router, backHref])

  // 새 문서의 첫 저장이 끝나면 기준을 새 v1 으로 바꾸고 수정 중을 잡는다(iframe 은 다시 로드되지 않는다)
  async function onFirstSaved(outcome: CreateDocumentOutcome) {
    setUploadFile(null)
    setBaseId(outcome.attachmentId)
    setShownNo(outcome.versionNo)
    setSavedNo(outcome.versionNo)
    setExportPending(false)
    setEditorDirty(exportedDirty.current)
    notifyEditChanged()
    // 주소는 /edit/new 그대로 둔다. 바꾸면 이후 서버 액션(새 버전 저장의 revalidate)이 바뀐 주소의 페이지(/edit/[id])를 다시 그려
    // 편집기가 통째로 다시 로드된다. 새로고침하면 /edit/new 가 주소의 게시물 id 로 이미 만든 문서를 알아보고 /edit/<id> 로 보낸다.
    await adopt(outcome.attachmentId)
  }

  function onBackClick() {
    if (dirty) setConfirmLeave(true)
    else goBack()
  }

  function requestSave() {
    setNotice(null)
    setEditorError(null)
    setSaving(true)
    editor.current?.requestSave()
  }

  function onSaveClick() {
    if (!isNew && officeExtensionWillChange(fileName)) setConfirmExt(true)
    else requestSave()
  }

  const status = saving
    ? '저장하는 중…'
    : dirty
      ? '저장 안 된 변경'
      : savedNo
        ? savedNo === 1 && newDocument
          ? '저장됨'
          : `저장됨 v${savedNo}`
        : phase === 'ready'
          ? '변경 없음'
          : '편집기를 불러오는 중…'

  const failedMessage =
    gate.kind === 'failed' ? gate.message : editorError && phase !== 'ready' ? editorError : null

  return (
    <div className="flex h-full flex-col" data-testid="office-edit-screen">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBackClick}>
          <ArrowLeftIcon aria-hidden="true" />
          돌아가기
        </Button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
          <span className="truncate" title={fileName}>
            {fileName}
          </span>
          {isNew && baseId === null ? (
            <Badge variant="secondary" className="shrink-0">
              새 문서
            </Badge>
          ) : (
            versionLabel(shownNo) && (
              <Badge variant="secondary" className="shrink-0">
                {versionLabel(shownNo)}
              </Badge>
            )
          )}
        </h1>
        <span
          role="status"
          aria-live="polite"
          className="text-xs whitespace-nowrap text-muted-foreground max-md:sr-only"
        >
          {status}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={phase !== 'ready' || saving || uploadFile !== null}
          onClick={onSaveClick}
        >
          <SaveIcon aria-hidden="true" />
          {isNew && baseId === null ? '저장' : '저장(새 버전)'}
        </Button>
        <span
          className="inline-flex items-center text-muted-foreground"
          data-tooltip={OFFICE_INFO_TEXT}
          aria-label={`안내: ${OFFICE_INFO_TEXT}`}
          role="img"
        >
          <InfoIcon aria-hidden="true" className="size-4" />
        </span>
      </header>

      {notice && (
        <NoticeBanner variant="bar" role="status">
          {notice}
        </NoticeBanner>
      )}
      {editorError && phase === 'ready' && (
        <NoticeBanner variant="bar" tone="destructive" role="alert">
          {editorError}
        </NoticeBanner>
      )}

      <div className="relative min-h-0 flex-1">
        {failedMessage ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <p className="text-sm">
              {failedMessage} 편집기를 열지 못했습니다 — 내 PC에서 수정을 써 주세요.
            </p>
            <Button type="button" onClick={goBack}>
              돌아가기
            </Button>
          </div>
        ) : alreadyCreated ? (
          <p role="status" className="p-8 text-center text-sm text-muted-foreground">
            이미 저장한 문서를 여는 중…
          </p>
        ) : gate.kind === 'open' ? (
          <OfficeEditorFrame
            ref={editor}
            origin={origin}
            parentOrigin={parentOrigin}
            fileName={fileName}
            loadBuffer={loadBuffer}
            onPhase={setPhase}
            onDirtyChange={setEditorDirty}
            onSaved={(file, info) => {
              setSaving(false)
              setExportPending(true)
              exportedDirty.current = info.dirty
              // 저장 대화상자가 이미 열려 있으면(uploadFile 설정됨) 새 파일로 바꾸지 않는다
              setUploadFile(prev => prev ?? file)
            }}
            onError={message => {
              setSaving(false)
              setEditorError(message)
            }}
          />
        ) : (
          gate.kind === 'checking' && (
            <div role="status">
              <EmptyState compact title="수정 중 표시를 남기는 중…" />
            </div>
          )
        )}
      </div>

      {newDocument && baseId === null && (
        <FirstSaveDialog
          file={uploadFile}
          channelId={channelId}
          type={newDocument.type}
          fileName={fileName}
          folderPath={newDocument.folderPath}
          parentId={newDocument.parentId}
          messageId={messageId}
          onSaved={onFirstSaved}
          onCancel={() => setUploadFile(null)}
        />
      )}

      <SaveVersionDialog
        open={uploadFile !== null && baseId !== null}
        onOpenChange={open => {
          if (!open) setUploadFile(null)
        }}
        channelId={channelId}
        baseAttachmentId={baseId ?? ''}
        fileName={fileName}
        nextVersionNo={nextVersionNo > shownNo ? nextVersionNo : shownNo + 1}
        initialFile={uploadFile}
        source="office-edit"
        onSaved={async saved => {
          baseRef.current = saved.attachmentId
          setBaseId(saved.attachmentId)
          setShownNo(saved.versionNo)
          setSavedNo(saved.versionNo)
          // 올라간 파일은 내보낸 시점의 내용 — 내보내는 동안 더 고친 게 있으면 변경 표시를 유지한다
          setExportPending(false)
          setEditorDirty(exportedDirty.current)
          notifyEditChanged()
          // 저장하면 서버가 수정 중 표시를 풀므로, 계속 편집할 수 있게 다시 잡는다(남이 잡았으면 조용히 넘어간다)
          await checkoutFile({ attachmentId: saved.attachmentId }).catch(() => undefined)
        }}
      />

      <VersionConfirmDialog
        open={gate.kind === 'held'}
        title="다른 사람이 수정 중입니다"
        description={
          gate.kind === 'held'
            ? `${checkoutHeldMessage(gate.name, formatSinceLabel(gate.since))} 그래도 편집할까요?`
            : ''
        }
        confirmLabel="그래도 편집"
        onCancel={goBack}
        onConfirm={() => {
          setGate({ kind: 'checking' })
          void enter(true)
        }}
      />

      <VersionConfirmDialog
        open={confirmExt}
        title="파일 형식이 바뀝니다"
        description={`‘${fileName}’은 옛 형식이라 저장하면 새 형식(.docx·.xlsx·.pptx)의 새 버전으로 올라갑니다. 저장할까요?`}
        confirmLabel="저장"
        onCancel={() => setConfirmExt(false)}
        onConfirm={() => {
          setConfirmExt(false)
          requestSave()
        }}
      />

      <VersionConfirmDialog
        open={confirmLeave}
        title="저장하지 않은 변경이 있습니다"
        description="나가면 저장하지 않은 변경 내용이 사라집니다. 그래도 나갈까요?"
        confirmLabel="저장 안 하고 나가기"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          setDirty(false)
          goBack()
        }}
      />
    </div>
  )
}
