'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { ArrowLeftIcon, SaveIcon } from 'lucide-work'
import { Badge } from '@work/components/ui/badge'
import { Button } from '@work/components/ui/button'
import { EmptyState, NoticeBanner } from '@work/components/layout/page'
import { checkoutFile } from '@work/lib/files/version-actions'
import type { HwpEditFormat } from '@work/lib/files/hwp-editor'
import { checkoutHeldMessage, formatSinceLabel, versionLabel } from '@work/lib/files/version-rules'
import { fileUrl } from '../FilePreviewBody'
import { useEditCheckout, useLeaveGuard } from '../office-edit/use-edit-checkout'
import VersionConfirmDialog from '../versions/VersionConfirmDialog'
import { notifyEditChanged } from '../versions/edit-handles'
import HwpEditorFrame, { type HwpEditorHandle, type HwpEditorPhase } from './HwpEditorFrame'
import HwpSaveDialog, { type HwpSavedVersion } from './HwpSaveDialog'

/** 새 한글 문서(docs/18 §4) — 기준 버전 없이 정적 서식으로 열고, 첫 저장 때 파일(v1)을 만든다 */
export type HwpNewDocumentScreenInfo = {
  /** 시작 서식 주소(`/doc-templates/blank.hwpx` 등) */
  templatePath: string
  folderPath: string | null
  /** 스레드 안에서 만들면 그 스레드 루트 메시지 id */
  parentId: string | null
  /** 돌아갈 대화 경로 */
  backHref: string
  /** 첫 저장 때 만들 게시물 id(주소 `id`). 없으면 화면이 새로 정한다 */
  messageId?: string
  /** 이 주소로 이미 만든 문서(새로고침 등) — 처음 그릴 때만 그 편집 화면으로 옮긴다 */
  createdAttachmentId?: string | null
}

/**
 * HWP·HWPX 앱 안 편집 화면(docs/12 §2-2 · docs/18 §4) — 앱 셸 밖. 머리줄(← 돌아가기 · 파일 이름 · 버전 · 상태 · 저장) + 편집기.
 * 들어오면 checkoutFile(남이 잡고 있으면 확인), 나가면 releaseCheckout — 오피스 화면(OfficeEditScreen)과 같은 훅을 쓴다.
 * 저장은 편집기에서 브라우저 검사 → HwpSaveDialog(업로드 → 서버 검증 → 미리보기 → 새 버전).
 */
export default function HwpEditScreen({
  attachmentId,
  fileName,
  channelId,
  versionNo,
  nextVersionNo,
  studioUrl,
  format = 'hwp',
  newDocument,
}: {
  /** 새 문서(newDocument)이면 null */
  attachmentId: string | null
  fileName: string
  channelId: string
  versionNo: number
  nextVersionNo: number
  /** `<편집기 출처>/rhwp/` */
  studioUrl: string
  format?: HwpEditFormat
  newDocument?: HwpNewDocumentScreenInfo
}) {
  const router = useRouter()
  const editor = useRef<HwpEditorHandle>(null)
  const { gate, setGate, enter, baseRef, adopt } = useEditCheckout(attachmentId)
  const isNew = attachmentId === null
  const [phase, setPhase] = useState<HwpEditorPhase>('loading')
  const [dirty, setDirty] = useState(false)
  const [checking, setChecking] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  // 저장이 끝나면 다음 저장의 기준 버전·표시 번호가 바뀐다
  const [baseId, setBaseId] = useState(attachmentId)
  // 새 문서의 게시물 id — 첫 저장 재시도가 같은 id 를 써서 두 번 만들지 않는다
  const [messageId] = useState(() => newDocument?.messageId ?? crypto.randomUUID())
  const [shownNo, setShownNo] = useState(versionNo)
  const [savedNo, setSavedNo] = useState<number | null>(null)
  const [saveFile, setSaveFile] = useState<File | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  useLeaveGuard(dirty)

  // 처음 그릴 때의 값만 본다 — 첫 저장 직후 서버 액션이 페이지를 다시 그리면 이 값이 채워져 오지만 그때는 옮기지 않는다
  const [alreadyCreated] = useState(() => newDocument?.createdAttachmentId ?? null)
  useEffect(() => {
    if (alreadyCreated) router.replace(`/edit/${alreadyCreated}`)
  }, [alreadyCreated, router])

  // 원본 바이트는 처음 열 때의 버전(attachmentId)으로 한 번만 받는다 — 저장 뒤에도 같은 편집기 문서로 계속 편집한다
  const templatePath = newDocument?.templatePath
  const loadBuffer = useCallback(async () => {
    const url = attachmentId ? fileUrl(attachmentId, { download: true }) : (templatePath ?? '')
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.arrayBuffer()
  }, [attachmentId, templatePath])

  const backHref = newDocument?.backHref
  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back()
    else router.push(backHref ?? '/files')
  }, [router, backHref])

  function onBackClick() {
    if (dirty) setConfirmLeave(true)
    else goBack()
  }

  function onSaveClick() {
    setEditorError(null)
    setChecking(true)
    editor.current?.requestSave()
  }

  const status = checking
    ? '저장본을 검사하는 중…'
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
    <div className="flex h-dvh flex-col" data-testid="hwp-edit-screen">
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
          disabled={phase !== 'ready' || checking || saveFile !== null}
          onClick={onSaveClick}
        >
          <SaveIcon aria-hidden="true" />
          {isNew && baseId === null ? '저장' : '저장(새 버전)'}
        </Button>
      </header>

      {editorError && phase === 'ready' && (
        <NoticeBanner variant="bar" tone="destructive" role="alert">
          {editorError}
        </NoticeBanner>
      )}

      <main id="main-content" className="relative min-h-0 flex-1">
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
          <HwpEditorFrame
            ref={editor}
            studioUrl={studioUrl}
            fileName={fileName}
            format={format}
            loadBuffer={loadBuffer}
            onPhase={setPhase}
            onDirtyChange={setDirty}
            onSaved={file => {
              setChecking(false)
              setSaveFile(file)
            }}
            onError={message => {
              setChecking(false)
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
      </main>

      <HwpSaveDialog
        open={saveFile !== null}
        onOpenChange={open => {
          if (!open) setSaveFile(null)
        }}
        channelId={channelId}
        baseAttachmentId={baseId}
        format={format}
        newDocument={
          newDocument
            ? {
                folderPath: newDocument.folderPath,
                parentId: newDocument.parentId,
                messageId,
              }
            : undefined
        }
        fileName={fileName}
        nextVersionNo={nextVersionNo > shownNo ? nextVersionNo : shownNo + 1}
        file={saveFile}
        onSaved={async (saved: HwpSavedVersion) => {
          const first = baseId === null
          baseRef.current = saved.attachmentId
          setBaseId(saved.attachmentId)
          setShownNo(saved.versionNo)
          setSavedNo(saved.versionNo)
          setDirty(false)
          notifyEditChanged()
          // 서버에 올라갔으니 편집기의 변경 표시·자동 복구 초안을 정리한다
          await editor.current?.markSaved()
          // 주소는 /edit/new 그대로 둔다(바꾸면 이후 서버 액션이 바뀐 주소를 다시 그려 편집기가 다시 로드된다) —
          // 새로고침하면 /edit/new 가 주소의 게시물 id 로 이미 만든 문서를 알아보고 /edit/<id> 로 보낸다.
          if (first) {
            // 새 문서의 첫 저장 — 새 v1 을 기준으로 수정 중 표시를 잡는다
            await adopt(saved.attachmentId)
            return
          }
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
