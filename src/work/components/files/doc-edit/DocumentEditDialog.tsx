'use client'

import { FieldLabel } from '@work/components/ui/field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2Icon } from 'lucide-work'
import { Button, buttonVariants } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { discardDraft, saveDraftAsNewFile } from '@work/lib/files/doc-edit-actions'
import {
  BLOCKED_HINT,
  firstTextValue,
  needsSkipConfirm,
  suggestNewFileName,
  type DraftOutcome,
  type EditableBlocks,
  type FormSchemaInfo,
} from '@work/lib/files/doc-edit-types'
import { formatDateTime } from '@work/lib/format/datetime'
import { saveFileVersion } from '@work/lib/files/version-actions'
import type { VersionConflictInfo } from '@work/lib/files/version-schema'
import { cn } from '@work/lib/utils'
import { namedFileUrl } from '../FilePreviewBody'
import VersionConfirmDialog from '../versions/VersionConfirmDialog'
import {
  DocEditHttpError,
  fetchEditableBlocks,
  fetchFormSchema,
  requestDraft,
} from './doc-edit-client'
import {
  hasChanges,
  hasFillValues,
  initEditorBlocks,
  summarizeChanges,
  toBlockInputs,
  toFillValues,
  type EditorBlock,
  type FillState,
} from './doc-edit-ui'
import DraftPreviewPane from './DraftPreviewPane'
import FormFillPane from './FormFillPane'
import TextEditPane from './TextEditPane'

export type DocEditMode = 'fill' | 'patch'

export type DocEditSaved = {
  kind: 'new-file' | 'new-version'
  fileName: string
  /** 대화 경로(`/c/<slug>` 등) — 새 파일이 올라간 곳 */
  conversationPath: string
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'fill'; schema: FormSchemaInfo }
  | { status: 'patch'; data: EditableBlocks }

type Phase = 'edit' | 'saving' | 'saved'
type SaveKind = 'new-file' | 'new-version'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

const TITLE: Record<DocEditMode, string> = { fill: '양식 채우기', patch: '문구 고치기' }

/**
 * 전체 화면 문서 편집 대화상자(docs/10 §2): 왼쪽 입력, 오른쪽 미리보기(좁으면 탭 전환).
 * 입력 → [미리보기](서버가 초안을 만들고 쪽 그림을 돌려준다) → 저장. 저장 버튼은 최신 입력으로 만든 초안이 있고
 * 막히지 않았을 때만 켜진다. 반영 안 된 수정이 있으면 저장 전에 확인한다. 막힌 초안은 "내 PC에서 수정"으로 안내한다.
 */
export default function DocumentEditDialog({
  open,
  onOpenChange,
  mode,
  attachmentId,
  fileName,
  onSaved,
  onUseLocalEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: DocEditMode
  attachmentId: string
  fileName: string
  onSaved?: (saved: DocEditSaved) => void | Promise<void>
  onUseLocalEdit?: () => void
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [fill, setFill] = useState<FillState>({})
  const [blocks, setBlocks] = useState<EditorBlock[]>([])
  const [originalCount, setOriginalCount] = useState(0)

  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [inputVersion, setInputVersion] = useState(0)
  const [outcomeVersion, setOutcomeVersion] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('edit')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<DocEditSaved | null>(null)
  const [newName, setNewName] = useState('')
  const [confirmSkip, setConfirmSkip] = useState<SaveKind | null>(null)
  const [conflict, setConflict] = useState<{
    latest: VersionConflictInfo
    consumed: boolean
  } | null>(null)
  const [pane, setPane] = useState<'input' | 'preview'>('input')

  const outcomeRef = useRef<DraftOutcome | null>(null)
  outcomeRef.current = outcome
  const phaseRef = useRef<Phase>('edit')
  phaseRef.current = phase

  // 열릴 때마다 처음부터 읽는다
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoad({ status: 'loading' })
    setFill({})
    setBlocks([])
    setOutcome(null)
    setOutcomeVersion(-1)
    setInputVersion(0)
    setPreviewError(null)
    setPhase('edit')
    setSaveError(null)
    setSaved(null)
    setConflict(null)
    setConfirmSkip(null)
    setPane('input')
    const run = mode === 'fill' ? fetchFormSchema(attachmentId) : fetchEditableBlocks(attachmentId)
    run
      .then(data => {
        if (cancelled) return
        if (mode === 'fill') {
          setLoad({ status: 'fill', schema: data as FormSchemaInfo })
        } else {
          const d = data as EditableBlocks
          setBlocks(initEditorBlocks(d.blocks))
          setOriginalCount(d.blocks.length)
          setLoad({ status: 'patch', data: d })
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoad({
          status: 'error',
          message: e instanceof DocEditHttpError ? e.message : NETWORK_ERROR,
        })
      })
    return () => {
      cancelled = true
    }
  }, [open, mode, attachmentId])

  const touch = useCallback(() => setInputVersion(v => v + 1), [])

  const fillValues = useMemo(
    () => (load.status === 'fill' ? toFillValues(load.schema, fill) : {}),
    [load, fill]
  )
  const changes = useMemo(() => summarizeChanges(blocks, originalCount), [blocks, originalCount])
  const canPreview =
    !busy &&
    phase === 'edit' &&
    (load.status === 'fill'
      ? hasFillValues(fillValues)
      : load.status === 'patch' && hasChanges(changes))
  const stale = outcome !== null && outcomeVersion !== inputVersion
  const canSave = outcome !== null && !stale && !outcome.blocked && !busy && phase === 'edit'

  async function preview() {
    if (load.status !== 'fill' && load.status !== 'patch') return
    setBusy(true)
    setPreviewError(null)
    const version = inputVersion
    const previousUploadId = outcome?.uploadId
    try {
      const o =
        load.status === 'fill'
          ? await requestDraft(attachmentId, { mode: 'fill', values: fillValues, previousUploadId })
          : await requestDraft(attachmentId, {
              mode: 'patch',
              blocks: toBlockInputs(blocks),
              baseHash: load.data.baseHash,
              previousUploadId,
            })
      setOutcome(o)
      setOutcomeVersion(version)
      setPane('preview')
      if (load.status === 'fill') {
        setNewName(suggestNewFileName(fileName, firstTextValue(load.schema.fields, fillValues)))
      } else {
        setNewName(suggestNewFileName(fileName, '수정'))
      }
    } catch (e) {
      setOutcome(null)
      setPreviewError(e instanceof DocEditHttpError ? e.message : NETWORK_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function runSave(kind: SaveKind, force = false) {
    if (!outcome) return
    setPhase('saving')
    setSaveError(null)
    try {
      if (kind === 'new-file') {
        const res = await saveDraftAsNewFile({
          sourceAttachmentId: attachmentId,
          uploadId: outcome.uploadId,
          fileName: newName,
        })
        if (!res.ok) {
          setSaveError(res.error)
          setPhase('edit')
          return
        }
        const done: DocEditSaved = {
          kind,
          fileName: res.data.fileName,
          conversationPath: res.data.conversationPath,
        }
        setSaved(done)
        setPhase('saved')
        setOutcome(null)
        await onSaved?.(done)
        return
      }
      const res = await saveFileVersion({
        baseAttachmentId: attachmentId,
        uploadId: outcome.uploadId,
        source: 'app-edit',
        force,
      })
      if (!res.ok) {
        setSaveError(res.error)
        setPhase('edit')
        return
      }
      if (res.data.status === 'conflict') {
        setConflict({ latest: res.data.latest, consumed: res.data.uploadConsumed })
        if (res.data.uploadConsumed) setOutcome(null) // 임시 파일이 소진됐다 — 미리보기를 다시 만들어야 한다
        setPhase('edit')
        return
      }
      const done: DocEditSaved = {
        kind,
        fileName: res.data.fileName,
        conversationPath: res.data.conversationPath,
      }
      setSaved(done)
      setPhase('saved')
      setOutcome(null)
      await onSaved?.(done)
    } catch {
      setSaveError(NETWORK_ERROR)
      setPhase('edit')
    }
  }

  function requestSave(kind: SaveKind) {
    if (!outcome || !canSave) return
    if (needsSkipConfirm(outcome)) {
      setConfirmSkip(kind)
      return
    }
    void runSave(kind)
  }

  function close(next: boolean) {
    if (!next && phase === 'saving') return
    if (!next) {
      // 저장하지 않은 초안은 치운다(못 치워도 24시간 뒤 정리)
      const o = outcomeRef.current
      if (o && phaseRef.current !== 'saved')
        void discardDraft({ uploadId: o.uploadId }).catch(() => undefined)
    }
    onOpenChange(next)
  }

  const primary: SaveKind = mode === 'fill' ? 'new-file' : 'new-version'
  const nameOk = newName.trim().length > 0
  const loadedPane =
    load.status === 'fill' ? (
      <FormFillPane
        schema={load.schema}
        state={fill}
        disabled={phase !== 'edit'}
        onChange={(k, v) => {
          setFill(s => ({ ...s, [k]: v }))
          touch()
        }}
      />
    ) : load.status === 'patch' ? (
      <TextEditPane
        blocks={blocks}
        originalCount={originalCount}
        canRestructure={load.data.canRestructure}
        disabled={phase !== 'edit'}
        onChange={next => {
          setBlocks(next)
          touch()
        }}
      />
    ) : null

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          className={cn(
            // 세로는 flex — 좁은 화면 탭 줄이 lg:hidden 으로 빠지면 grid-rows 고정 칸이 한 칸씩 밀려
            // 바닥줄이 1fr 칸에 눌려 버튼이 가장자리에 붙었다(docs/13 §7). 본문만 flex-1 로 남는 높이를 갖는다.
            'top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none sm:max-w-none'
          )}
        >
          <DialogHeader>
            <DialogTitle className="leading-snug break-words">
              {TITLE[mode]} — {fileName}
            </DialogTitle>
            {/* 폰은 설명이 4줄이라 본문이 ~180px 로 눌린다 — 화면에서만 숨기고 읽어 주는 설명은 남긴다 */}
            <DialogDescription className="max-sm:sr-only">
              {mode === 'fill'
                ? '칸을 채우고 미리보기로 확인한 뒤 새 파일(또는 새 버전)으로 저장합니다. 원본은 그대로 남습니다.'
                : '글자를 고치고 미리보기로 확인한 뒤 새 버전(또는 새 파일)으로 저장합니다. 이전 버전은 버전 기록에 남습니다.'}
            </DialogDescription>
          </DialogHeader>

          {/* 좁은 화면은 입력/미리보기 탭 전환 */}
          <div role="tablist" aria-label="화면 전환" className="flex gap-1 lg:hidden">
            {(['input', 'preview'] as const).map(p => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={pane === p}
                className={cn(
                  buttonVariants({ variant: pane === p ? 'default' : 'outline', size: 'sm' })
                )}
                onClick={() => setPane(p)}
              >
                {p === 'input' ? '입력' : '미리보기'}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
            <section
              aria-label="입력"
              className={cn(
                'min-h-0 overflow-y-auto pr-1',
                pane === 'preview' && 'hidden lg:block'
              )}
            >
              {load.status === 'loading' && (
                <p role="status" className="text-sm text-muted-foreground">
                  문서를 읽는 중…
                </p>
              )}
              {load.status === 'error' && (
                <div role="alert" className="grid gap-2 text-sm">
                  <p className="text-destructive">{load.message}</p>
                  {onUseLocalEdit && (
                    <div>
                      <Button type="button" size="sm" variant="outline" onClick={onUseLocalEdit}>
                        내 PC에서 수정
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {loadedPane}
              {(load.status === 'fill' || load.status === 'patch') && (
                <div className="mt-4">
                  <Button type="button" disabled={!canPreview} onClick={() => void preview()}>
                    {busy ? '미리보기를 만드는 중…' : '미리보기'}
                  </Button>
                </div>
              )}
            </section>

            <section
              aria-label="미리보기"
              className={cn(
                'min-h-0 overflow-y-auto rounded-w-md border bg-muted/50',
                pane === 'input' && 'hidden lg:block'
              )}
            >
              {phase === 'saved' && saved ? (
                <div role="status" className="grid gap-2 p-4 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2Icon aria-hidden="true" className="size-4 text-online" />
                    {saved.kind === 'new-file'
                      ? `‘${saved.fileName}’ 새 파일로 저장했습니다.`
                      : `‘${saved.fileName}’ 새 버전으로 저장했습니다.`}
                  </p>
                  {saved.kind !== 'new-version' && (
                    <a
                      href={saved.conversationPath}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      대화로 가기
                    </a>
                  )}
                </div>
              ) : (
                <DraftPreviewPane
                  attachmentId={attachmentId}
                  outcome={outcome}
                  stale={stale}
                  busy={busy}
                  error={previewError}
                  onUseLocalEdit={onUseLocalEdit}
                />
              )}
            </section>
          </div>

          <DialogFooter className="flex-row flex-wrap items-center justify-end">
            {phase === 'saved' ? (
              <Button type="button" onClick={() => close(false)}>
                닫기
              </Button>
            ) : (
              <>
                {saveError && (
                  <p role="alert" className="w-full text-sm text-destructive sm:mr-auto sm:w-auto">
                    {saveError}
                  </p>
                )}
                {outcome?.blocked && (
                  <p className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">
                    {BLOCKED_HINT}
                  </p>
                )}
                <div className="flex w-full min-w-0 items-center gap-2 text-sm sm:mr-auto sm:w-auto">
                  <FieldLabel htmlFor="doc-edit-new-name" className="shrink-0">
                    새 파일 이름
                  </FieldLabel>
                  <Input
                    id="doc-edit-new-name"
                    className="w-full min-w-0 sm:w-64"
                    value={newName}
                    disabled={!outcome || phase !== 'edit'}
                    onChange={e => setNewName(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={phase === 'saving'}
                  onClick={() => close(false)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant={primary === 'new-version' ? 'outline' : 'default'}
                  disabled={!canSave || !nameOk}
                  onClick={() => requestSave('new-file')}
                >
                  새 파일로 저장
                </Button>
                <Button
                  type="button"
                  variant={primary === 'new-version' ? 'default' : 'outline'}
                  disabled={!canSave}
                  onClick={() => requestSave('new-version')}
                >
                  {phase === 'saving' ? '저장하는 중…' : '새 버전으로 저장'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VersionConfirmDialog
        open={confirmSkip !== null}
        title="반영되지 않은 수정이 있습니다"
        description={`${outcome?.skipped.length ?? 0}개 수정은 반영되지 않았습니다. 그래도 저장할까요?`}
        confirmLabel="그래도 저장"
        onCancel={() => setConfirmSkip(null)}
        onConfirm={() => {
          const kind = confirmSkip
          setConfirmSkip(null)
          if (kind) void runSave(kind)
        }}
      />

      <VersionConfirmDialog
        open={conflict !== null}
        title="다른 사람이 먼저 저장했습니다"
        description={
          conflict
            ? `다른 사람이 먼저 v${conflict.latest.versionNo}을 저장했습니다(${conflict.latest.uploaderName ?? '알 수 없는 사용자'}, ${formatDateTime(conflict.latest.createdAt)}).${
                conflict.consumed
                  ? ' 동시에 저장되어 미리보기를 다시 만들어야 합니다.'
                  : ` 그래도 내 수정을 v${conflict.latest.versionNo + 1}로 저장할까요?`
              }`
            : ''
        }
        confirmLabel={
          conflict?.consumed
            ? '확인'
            : conflict
              ? `그래도 v${conflict.latest.versionNo + 1}로 저장`
              : ''
        }
        extra={
          conflict && (
            <a
              href={namedFileUrl(conflict.latest.id, conflict.latest.name)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline' })}
            >
              최신본 보기
            </a>
          )
        }
        onCancel={() => setConflict(null)}
        onConfirm={() => {
          const consumed = conflict?.consumed ?? false
          setConflict(null)
          if (!consumed) void runSave('new-version', true)
        }}
      />
    </>
  )
}
