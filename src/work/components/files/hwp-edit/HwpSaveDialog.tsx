'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-work'
import { NoticeBanner } from '@work/components/layout/page'
import { Button, buttonVariants } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { createDocument } from '@work/lib/files/create-actions'
import { discardDraft } from '@work/lib/files/doc-edit-actions'
import {
  hasObjectsDropped,
  objectsDroppedMessage,
  type DraftOutcome,
} from '@work/lib/files/doc-edit-types'
import type { HwpEditFormat } from '@work/lib/files/hwp-editor'
import { formatDateTime } from '@work/lib/format/datetime'
import { saveFileVersion } from '@work/lib/files/version-actions'
import type { VersionConflictInfo } from '@work/lib/files/version-schema'
import { namedFileUrl } from '../FilePreviewBody'
import { useAttachmentUploads } from '../useAttachmentUploads'
import DraftPreviewPane from '../doc-edit/DraftPreviewPane'
import { verifyHwpSave, verifyNewHwpxSave } from '../doc-edit/doc-edit-client'
import VersionConfirmDialog from '../versions/VersionConfirmDialog'

export type HwpSavedVersion = { attachmentId: string; versionNo: number; fileName: string }

type Phase = 'uploading' | 'verifying' | 'review' | 'blocked' | 'saving' | 'saved' | 'failed'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 새 한글 문서(docs/18 §4)의 첫 저장 — 기준 버전이 없고, 통과하면 `createDocument` 로 v1 을 만든다 */
export type HwpNewDocumentInfo = {
  folderPath: string | null
  /** 스레드 안에서 만들면 그 스레드 루트 메시지 id */
  parentId: string | null
  /** 게시물 id — 화면이 한 번 정해 계속 쓴다(재시도 멱등) */
  messageId: string
}

/**
 * HWP·HWPX 앱 안 편집 저장 대화상자(docs/12 §2-3 ③~⑥ · docs/18 §2): 브라우저 검사를 통과한 저장본(file)을 1단계 업로드(pending)로 올리고,
 * 서버 verify 라우트(kordoc 검증 + draft_meta 기록)를 부른 뒤, 통과하면 초안 미리보기(쪽 그림)를 보여 주고
 * [새 버전으로 저장] 으로 `saveFileVersion({ source:'hwp-editor' })` 를 한다. 막히면 안내하고 올린 저장본을 버린다.
 * 충돌(다른 사람이 먼저 저장)은 1단계 대화상자와 같은 확인 대화상자.
 * HWPX 는 개체(표·그림·도형·수식)가 원본보다 줄었으면 저장 전에 "직접 지운 게 맞나요?" 확인을 받는다.
 * 새 문서(`newDocument`)는 원본이 없어 새 문서 verify 를 부르고, 저장은 `createDocument`(v1 + 게시물).
 */
export default function HwpSaveDialog({
  open,
  onOpenChange,
  channelId,
  baseAttachmentId,
  format = 'hwp',
  newDocument,
  fileName,
  nextVersionNo,
  file,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: string
  /** 내가 편집을 시작한(또는 직전에 저장한) 버전. 새 문서의 첫 저장이면 null */
  baseAttachmentId: string | null
  format?: HwpEditFormat
  /** 새 문서의 첫 저장(baseAttachmentId 가 null)일 때 */
  newDocument?: HwpNewDocumentInfo
  fileName: string
  nextVersionNo?: number
  /** 검사를 통과한 저장본 */
  file: File | null
  onSaved?: (saved: HwpSavedVersion) => void | Promise<void>
}) {
  const uploads = useAttachmentUploads({ channelId })
  const [phase, setPhase] = useState<Phase>('uploading')
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [announce, setAnnounce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    latest: VersionConflictInfo
    consumed: boolean
  } | null>(null)
  const [saved, setSaved] = useState<HwpSavedVersion | null>(null)
  const [confirmDropped, setConfirmDropped] = useState(false)
  // 새 문서의 첫 저장이 끝나면 부모가 기준 버전을 바꿔 baseAttachmentId 가 채워지지만, 이 대화상자 안의 문구는 "새 문서"로 남긴다
  const [createdNew, setCreatedNew] = useState(false)
  const seededFor = useRef<File | null>(null)
  const verifiedFor = useRef<string | null>(null)

  const { addFiles, clear } = uploads
  const item = uploads.items[0]
  const uploadId = uploads.items.length === 1 ? uploads.uploadIds[0] : undefined

  // 열릴 때마다 처음 상태로
  useEffect(() => {
    if (!open) {
      seededFor.current = null
      verifiedFor.current = null
      return
    }
    setPhase('uploading')
    setOutcome(null)
    setError(null)
    setConflict(null)
    setSaved(null)
    setConfirmDropped(false)
    setCreatedNew(false)
    setAnnounce(false)
  }, [open])

  // 저장본을 임시 업로드로 올린다
  useEffect(() => {
    if (!open || !file || seededFor.current === file) return
    seededFor.current = file
    addFiles([file])
  }, [open, file, addFiles])

  useEffect(() => {
    if (open && phase === 'uploading' && item?.status === 'error') {
      setError(item.error ?? '저장본을 올리지 못했습니다.')
      setPhase('failed')
    }
  }, [open, phase, item])

  // 업로드가 끝나면 서버 검증
  useEffect(() => {
    if (!open || phase !== 'uploading' || !uploadId || verifiedFor.current === uploadId) return
    verifiedFor.current = uploadId
    setPhase('verifying')
    const verifying = baseAttachmentId
      ? verifyHwpSave(baseAttachmentId, uploadId)
      : verifyNewHwpxSave(uploadId, newDocument?.parentId ?? null)
    verifying.then(
      res => {
        setOutcome(res)
        if (res.blocked) {
          // 서버가 막힌 저장본을 이미 치웠다 — 화면의 업로드 목록만 정리한다
          clear()
          setPhase('blocked')
        } else {
          setPhase('review')
        }
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : NETWORK_ERROR)
        setPhase('failed')
      }
    )
  }, [open, phase, uploadId, baseAttachmentId, newDocument?.parentId, clear])

  const submit = useCallback(
    async (force = false) => {
      if (!uploadId || phase === 'saving') return
      setPhase('saving')
      setError(null)
      try {
        if (!baseAttachmentId) {
          // 새 문서의 첫 저장 — createDocument 가 v1 과 게시물을 만든다
          if (!newDocument) {
            setError('새 문서 정보를 찾을 수 없습니다.')
            setPhase('review')
            return
          }
          const created = await createDocument({
            messageId: newDocument.messageId,
            channelId,
            uploadId,
            type: 'hwpx',
            fileName,
            folderPath: newDocument.folderPath,
            parentId: newDocument.parentId,
          })
          if (!created.ok) {
            setError(created.error)
            setPhase('review')
            return
          }
          const first: HwpSavedVersion = {
            attachmentId: created.data.attachmentId,
            versionNo: 1,
            fileName: created.data.fileName,
          }
          // 서버가 업로드를 확정하고 임시 행도 지웠다 — 목록에서만 뺀다
          uploads.forget(uploads.uploadIds)
          setCreatedNew(true)
          setSaved(first)
          setPhase('saved')
          await onSaved?.(first)
          return
        }
        const res = await saveFileVersion({
          baseAttachmentId,
          uploadId,
          announce,
          force,
          source: 'hwp-editor',
        })
        if (!res.ok) {
          setError(res.error)
          setPhase('review')
          return
        }
        if (res.data.status === 'conflict') {
          setConflict({ latest: res.data.latest, consumed: res.data.uploadConsumed })
          if (res.data.uploadConsumed) clear()
          setPhase(res.data.uploadConsumed ? 'failed' : 'review')
          return
        }
        const done: HwpSavedVersion = {
          attachmentId: res.data.attachmentId,
          versionNo: res.data.versionNo,
          fileName: res.data.fileName,
        }
        // 업로드는 서버가 이미 확정했다 — 목록만 비운다(discard 를 부르지 않게)
        uploads.items.forEach(it => uploads.removeItem(it.localId))
        setSaved(done)
        setPhase('saved')
        await onSaved?.(done)
      } catch {
        setError(NETWORK_ERROR)
        setPhase('review')
      }
    },
    [
      uploadId,
      phase,
      baseAttachmentId,
      newDocument,
      channelId,
      fileName,
      announce,
      uploads,
      clear,
      onSaved,
    ]
  )

  function close(next: boolean) {
    if (!next && (phase === 'saving' || phase === 'verifying')) return
    if (!next && phase !== 'saved') {
      // 저장하지 않고 닫는다 — 서버의 초안(저장본·미리보기)을 버린다
      if (uploadId && phase === 'review') void discardDraft({ uploadId }).catch(() => undefined)
      clear()
    }
    onOpenChange(next)
  }

  const busy = phase === 'uploading' || phase === 'verifying'
  const dropped = hasObjectsDropped(outcome?.objectsDropped) ? outcome?.objectsDropped : undefined
  const isNew = !baseAttachmentId || createdNew
  const formatLabel = format === 'hwpx' ? 'HWPX' : 'HWP'

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {phase === 'saved'
                ? isNew
                  ? '새 문서를 저장했습니다'
                  : '새 버전을 저장했습니다'
                : `‘${fileName}’ 저장 확인`}
            </DialogTitle>
            <DialogDescription>
              {phase === 'saved'
                ? '이전 버전은 버전 기록에 그대로 남습니다. 한글에서 한 번 열어 확인해 주세요.'
                : isNew
                  ? `검사를 통과하면 이 대화에 새 ${formatLabel} 파일(v1)로 올라갑니다.`
                  : `검사를 통과하면 새 최신 버전${nextVersionNo ? `(v${nextVersionNo})` : ''}으로 저장됩니다. 이전 버전은 버전 기록에 남습니다.`}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {phase === 'saved' && saved ? (
              <p role="status" className="flex items-center gap-2 text-sm">
                <CheckCircle2Icon aria-hidden="true" className="size-4 text-online" />
                {isNew
                  ? `‘${saved.fileName}’을 만들었습니다`
                  : `‘${saved.fileName}’ v${saved.versionNo}으로 저장됨`}
              </p>
            ) : busy ? (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                {phase === 'uploading' ? '저장본을 올리는 중…' : '저장본을 검사하는 중…'}
              </p>
            ) : phase === 'failed' ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                {error ?? '저장본을 처리하지 못했습니다.'}
              </p>
            ) : (
              <>
                <DraftPreviewPane
                  attachmentId={baseAttachmentId}
                  outcome={outcome}
                  stale={false}
                  busy={false}
                  error={null}
                />
                {phase !== 'blocked' && format === 'hwpx' && !isNew && (
                  <PageDelta outcome={outcome} />
                )}
                {phase !== 'blocked' && dropped && (
                  <div className="px-4 pb-2" data-testid="objects-dropped">
                    <NoticeBanner role="alert" tone="destructive" icon={AlertTriangleIcon}>
                      {objectsDroppedMessage(dropped)}
                    </NoticeBanner>
                  </div>
                )}
                {phase !== 'blocked' && !isNew && (
                  <label className="flex items-center gap-2 px-4 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={announce}
                      onChange={e => setAnnounce(e.target.checked)}
                      disabled={phase === 'saving'}
                    />
                    채널에도 알리기
                  </label>
                )}
                {phase === 'saving' && (
                  <p role="status" className="px-4 text-sm text-muted-foreground">
                    저장하는 중…
                  </p>
                )}
                {error && (
                  <p role="alert" className="px-4 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            {phase === 'saved' ? (
              <Button type="button" onClick={() => close(false)}>
                닫기
              </Button>
            ) : phase === 'blocked' || phase === 'failed' ? (
              <Button type="button" onClick={() => close(false)}>
                {phase === 'blocked' ? '확인' : '닫기'}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || phase === 'saving'}
                  onClick={() => close(false)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  disabled={phase !== 'review'}
                  onClick={() => (dropped ? setConfirmDropped(true) : void submit(false))}
                >
                  {phase === 'saving' ? '저장하는 중…' : isNew ? '저장' : '새 버전으로 저장'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VersionConfirmDialog
        open={confirmDropped}
        title="개체가 줄었습니다"
        description={dropped ? objectsDroppedMessage(dropped) : ''}
        confirmLabel="직접 지웠습니다 — 저장"
        onCancel={() => setConfirmDropped(false)}
        onConfirm={() => {
          setConfirmDropped(false)
          void submit(false)
        }}
      />

      <VersionConfirmDialog
        open={conflict !== null}
        title="다른 사람이 먼저 저장했습니다"
        description={
          conflict
            ? `다른 사람이 먼저 v${conflict.latest.versionNo}을 저장했습니다(${conflict.latest.uploaderName ?? '알 수 없는 사용자'}, ${formatDateTime(conflict.latest.createdAt)}).${
                conflict.consumed
                  ? ' 동시에 저장되어 저장본을 다시 만들어야 합니다 — 편집 화면에서 다시 저장해 주세요.'
                  : ` 그래도 내 파일을 v${conflict.latest.versionNo + 1}로 저장할까요?`
              }`
            : ''
        }
        confirmLabel={
          conflict?.consumed
            ? '확인'
            : conflict
              ? `그래도 내 파일을 v${conflict.latest.versionNo + 1}로 저장`
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
          const wasConsumed = conflict?.consumed ?? false
          setConflict(null)
          if (!wasConsumed) void submit(true)
        }}
      />
    </>
  )
}

/** HWPX 는 쪽 수로 막지 않는다 — 원본과 달라졌으면 "원본 n쪽 → m쪽"으로 알린다(docs/18 §2) */
function PageDelta({ outcome }: { outcome: DraftOutcome | null }) {
  if (!outcome || outcome.originalPageCount === null || outcome.pageCount === null) return null
  return (
    <p className="px-4 pb-2 text-xs text-muted-foreground" data-testid="page-delta">
      원본 {outcome.originalPageCount}쪽 → {outcome.pageCount}쪽
    </p>
  )
}
