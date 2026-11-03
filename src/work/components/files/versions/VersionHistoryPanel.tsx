'use client'

import { useState } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { Badge } from '@work/components/ui/badge'
import { Button, buttonVariants } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { formatDateTime } from '@work/lib/format/datetime'
import { formatBytes } from '@work/lib/files/mime'
import { markFinalVersion, restoreFileVersion } from '@work/lib/files/version-actions'
import type { FileVersionItem, FileVersionState } from '@work/lib/files/version-rules'
import { cn } from '@work/lib/utils'
import { fileUrl, namedFileUrl } from '../FilePreviewBody'
import { notifyEditChanged } from './edit-handles'
import VersionConfirmDialog from './VersionConfirmDialog'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 버전 기록 패널(docs/09 §3-2, 메모 탭 NoteHistoryPanel 의 모양): 최신 → 오래된 순,
 * 각 행 "v번호 · 올린 사람 · 시각 · 크기" + [열기] [이 버전으로 되돌리기](최신이 아닌 행) [최종으로 지정/해제].
 * 되돌리기·최종 지정은 편집 권한(state.canEdit)이 있을 때만 보인다. 삭제된 게시물의 버전은 열 수 없다.
 */
export default function VersionHistoryPanel({
  open,
  onOpenChange,
  state,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: FileVersionState
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<FileVersionItem | null>(null)

  function done() {
    notifyEditChanged()
    router.refresh()
  }

  async function toggleFinal(v: FileVersionItem) {
    setBusyId(v.id)
    setError(null)
    try {
      const res = v.isFinal
        ? await markFinalVersion({ rootAttachmentId: state.rootId, clear: true })
        : await markFinalVersion({ attachmentId: v.id })
      if (!res.ok) setError(res.error)
      else done()
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  async function restore() {
    const target = restoreTarget
    if (!target) return
    setBusyId(target.id)
    setError(null)
    try {
      const res = await restoreFileVersion({ versionAttachmentId: target.id })
      if (!res.ok) setError(res.error)
      else {
        setRestoreTarget(null)
        done()
      }
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>버전 기록</DialogTitle>
            <DialogDescription>
              버전 {state.versions.length}개 · 옛 버전을 되돌려도 이력은 지워지지 않고 새 버전으로
              쌓입니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <ol aria-label="버전 목록" className="grid gap-2">
            {state.versions.map(v => (
              <li
                key={v.id}
                className={cn(
                  'grid gap-1.5 rounded-w-lg border px-4 py-3 text-sm',
                  v.id === state.attachmentId && 'border-primary bg-subtle',
                  v.deleted && 'text-muted-foreground'
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">v{v.versionNo}</span>
                  {v.isLatest && <Badge variant="outline">최신</Badge>}
                  {v.isFinal && <Badge variant="success">최종</Badge>}
                  {v.deleted && <Badge variant="outline">삭제된 버전</Badge>}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={v.name}>
                    {v.name}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.uploaderName ?? '알 수 없는 사용자'} · {formatDateTime(v.createdAt)} ·{' '}
                  {formatBytes(v.size)}
                </p>
                {!v.deleted && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={namedFileUrl(v.id, v.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`v${v.versionNo} 열기`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      열기
                    </a>
                    <a
                      href={fileUrl(v.id, { download: true })}
                      download={v.name}
                      aria-label={`v${v.versionNo} 내려받기`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      내려받기
                    </a>
                    {state.canEdit && !v.isLatest && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId !== null}
                        aria-label={`v${v.versionNo}로 되돌리기`}
                        onClick={() => setRestoreTarget(v)}
                      >
                        이 버전으로 되돌리기
                      </Button>
                    )}
                    {state.canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyId !== null}
                        aria-label={`v${v.versionNo} ${v.isFinal ? '최종 지정 해제' : '최종으로 지정'}`}
                        onClick={() => void toggleFinal(v)}
                      >
                        {v.isFinal ? '최종 해제' : '최종으로 지정'}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>

      <VersionConfirmDialog
        open={restoreTarget !== null}
        title={`v${restoreTarget?.versionNo ?? ''}로 되돌릴까요?`}
        description="이 버전의 내용을 복사해 새 최신 버전으로 만듭니다. 지금까지의 버전은 모두 남습니다."
        confirmLabel="되돌리기"
        pending={busyId !== null}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void restore()}
      />
    </>
  )
}
