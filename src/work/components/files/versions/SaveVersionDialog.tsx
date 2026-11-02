'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2Icon } from 'lucide-work'
import TabFileUploader from '@work/components/tabs/TabFileUploader'
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
import { formatDateTime } from '@work/lib/format/datetime'
import { saveFileVersion } from '@work/lib/files/version-actions'
import type { VersionConflictInfo } from '@work/lib/files/version-schema'
import { extensionsMatch } from '@work/lib/files/version-rules'
import { namedFileUrl } from '../FilePreviewBody'
import { useAttachmentUploads } from '../useAttachmentUploads'
import VersionConfirmDialog from './VersionConfirmDialog'

export type SavedVersion = { attachmentId: string; versionNo: number; fileName: string }

type Phase = 'pick' | 'saving' | 'saved'

const NETWORK_ERROR = '네트워크 문제로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 수정본 저장 대화상자(docs/09 §3-1). 파일을 고르거나(끌어다 놓기 포함) 보관된 파일 핸들에서 읽은 파일(initialFile)로
 * 열면, 올린 뒤 saveFileVersion 으로 새 최신 버전을 만든다. initialFile 이 있고 확장자가 맞으면 **자동 저장**한다
 * (File System Access API 의 "수정본 올리기" 한 번 클릭).
 * 확장자가 원본과 다르면(hwp↔hwpx 같은 호환 쌍 제외) 확인 체크가 필요하다. 충돌이면 확인 대화상자를 띄운다.
 */
export default function SaveVersionDialog({
  open,
  onOpenChange,
  channelId,
  baseAttachmentId,
  fileName,
  nextVersionNo,
  initialFile = null,
  source,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: string
  /** 내가 받은(열어 본) 버전 — 이게 현재 최신이 아니면 충돌 */
  baseAttachmentId: string
  /** 원본 파일 이름(확장자 비교·제목) */
  fileName: string
  /** 저장하면 붙을 번호(안내용) */
  nextVersionNo?: number
  initialFile?: File | null
  /** 오피스 앱 편집(docs/11)이 올릴 때 — 게시물 문구에 "(앱에서 편집)"을 붙인다 */
  source?: 'office-edit'
  onSaved?: (saved: SavedVersion) => void | Promise<void>
}) {
  const uploads = useAttachmentUploads({ channelId })
  const [phase, setPhase] = useState<Phase>('pick')
  const [announce, setAnnounce] = useState(false)
  const [mismatchOk, setMismatchOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    latest: VersionConflictInfo
    consumed: boolean
  } | null>(null)
  const [saved, setSaved] = useState<SavedVersion | null>(null)
  const autoTried = useRef(false)
  const seededFor = useRef<File | null>(null)

  const item = uploads.items[0]
  const ready = uploads.items.length === 1 && uploads.uploadIds.length === 1
  const mismatch = item ? !extensionsMatch(fileName, item.name) : false
  const { addFiles, clear } = uploads

  // 열릴 때마다 초기 상태로(저장이 끝난 대화상자를 다시 열면 새 흐름)
  useEffect(() => {
    if (!open) {
      seededFor.current = null
      autoTried.current = false
      return
    }
    setPhase('pick')
    setError(null)
    setConflict(null)
    setSaved(null)
    setMismatchOk(false)
    setAnnounce(false)
  }, [open])

  // 보관된 핸들에서 읽은 수정본을 자동으로 올리기 시작한다
  useEffect(() => {
    // 대화상자를 연 동안 한 번만 심는다 — 뒤늦게 다른 파일이 오면 무시(항목이 2개가 되어 저장이 막히거나 업로드가 남는 것을 막는다)
    if (!open || !initialFile || seededFor.current !== null) return
    seededFor.current = initialFile
    autoTried.current = false
    addFiles([initialFile])
  }, [open, initialFile, addFiles])

  const submit = useCallback(
    async (force = false) => {
      if (!ready || phase === 'saving') return
      setPhase('saving')
      setError(null)
      try {
        const res = await saveFileVersion({
          baseAttachmentId,
          uploadId: uploads.uploadIds[0],
          announce,
          force,
          ...(source ? { source } : {}),
        })
        if (!res.ok) {
          setError(res.error)
          setPhase('pick')
          return
        }
        if (res.data.status === 'conflict') {
          setConflict({ latest: res.data.latest, consumed: res.data.uploadConsumed })
          if (res.data.uploadConsumed) clear()
          setPhase('pick')
          return
        }
        const done: SavedVersion = {
          attachmentId: res.data.attachmentId,
          versionNo: res.data.versionNo,
          fileName: res.data.fileName,
        }
        // 업로드는 서버가 이미 확정했다 — 임시 업로드 목록만 비운다(discard 를 부르지 않게 상태만 정리)
        uploads.items.forEach(it => uploads.removeItem(it.localId))
        setSaved(done)
        setPhase('saved')
        await onSaved?.(done)
      } catch {
        setError(NETWORK_ERROR)
        setPhase('pick')
      }
    },
    [ready, phase, baseAttachmentId, uploads, announce, clear, onSaved, source]
  )

  // 자동 저장(핸들에서 읽은 수정본, 확장자 일치)
  useEffect(() => {
    if (!open || !initialFile || autoTried.current) return
    if (!ready || mismatch || phase !== 'pick' || conflict) return
    autoTried.current = true
    void submit(false)
  }, [open, initialFile, ready, mismatch, phase, conflict, submit])

  function close(next: boolean) {
    if (!next && phase === 'saving') return
    if (!next && phase !== 'saved') clear()
    onOpenChange(next)
  }

  const canSubmit = ready && phase === 'pick' && (!mismatch || mismatchOk)

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {phase === 'saved' ? '새 버전을 저장했습니다' : `‘${fileName}’ 수정본 올리기`}
            </DialogTitle>
            <DialogDescription>
              {phase === 'saved'
                ? '이전 버전은 버전 기록에 그대로 남습니다.'
                : `올린 파일이 새 최신 버전${nextVersionNo ? `(v${nextVersionNo})` : ''}이 됩니다. 이전 버전은 버전 기록에 남습니다.`}
            </DialogDescription>
          </DialogHeader>

          {phase === 'saved' && saved ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <CheckCircle2Icon aria-hidden="true" className="size-4 text-online" />‘
              {saved.fileName}’ v{saved.versionNo}으로 저장됨
            </p>
          ) : (
            <div className="grid gap-4">
              <TabFileUploader uploads={uploads} disabled={phase === 'saving'} />
              {mismatch && item && (
                <NoticeBanner>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={mismatchOk}
                      onChange={e => setMismatchOk(e.target.checked)}
                    />
                    <span>
                      원본은 ‘{fileName}’인데 올린 파일은 ‘{item.name}’입니다. 확장자가 달라도 새
                      버전으로 저장합니다.
                    </span>
                  </label>
                </NoticeBanner>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={announce}
                  onChange={e => setAnnounce(e.target.checked)}
                  disabled={phase === 'saving'}
                />
                채널에도 알리기
              </label>
              {phase === 'saving' && (
                <p role="status" className="text-sm text-muted-foreground">
                  저장하는 중…
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {phase === 'saved' ? (
              <Button type="button" onClick={() => close(false)}>
                닫기
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={phase === 'saving'}
                  onClick={() => close(false)}
                >
                  취소
                </Button>
                <Button type="button" disabled={!canSubmit} onClick={() => void submit(false)}>
                  {phase === 'saving' ? '저장하는 중…' : '새 버전으로 저장'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VersionConfirmDialog
        open={conflict !== null}
        title="다른 사람이 먼저 저장했습니다"
        description={
          conflict
            ? `다른 사람이 먼저 v${conflict.latest.versionNo}을 저장했습니다(${conflict.latest.uploaderName ?? '알 수 없는 사용자'}, ${formatDateTime(conflict.latest.createdAt)}).${
                conflict.consumed
                  ? ' 동시에 저장되어 올린 파일을 다시 올려야 합니다.'
                  : ` 그래도 내 파일을 v${conflict.latest.versionNo + 1}로 저장할까요?`
              }`
            : ''
        }
        confirmLabel={
          conflict?.consumed
            ? '파일 다시 올리기'
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
          // 임시 업로드가 쓰였으면 파일을 다시 올린 뒤 저장 버튼으로 진행한다
          if (!wasConsumed) void submit(true)
        }}
      />
    </>
  )
}
