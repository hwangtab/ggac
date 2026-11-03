'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { createDocument } from '@work/lib/files/create-actions'
import type { CreateDocumentOutcome, OfficeCreateType } from '@work/lib/files/create-rules'
import { useAttachmentUploads } from '../useAttachmentUploads'

const NETWORK_ERROR = '네트워크 문제로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 새 문서의 첫 저장(docs/16 §3) — 충돌이 없으므로 확인 없이 진행 상황만 보여 준다.
 * 편집기가 내보낸 파일(file)을 임시 업로드 → createDocument(v1 + 게시물). 실패하면 닫지 않고 "다시 시도"를 준다
 * (올린 파일·게시물 id 를 그대로 써서 재시도가 두 번 만들지 않는다). 닫으면(취소) 올린 임시 파일을 지운다.
 */
export default function FirstSaveDialog({
  file,
  channelId,
  type,
  fileName,
  folderPath,
  parentId,
  messageId,
  onSaved,
  onCancel,
}: {
  /** 편집기가 내보낸 파일. null 이면 닫힌 상태 */
  file: File | null
  channelId: string
  type: OfficeCreateType
  fileName: string
  folderPath: string | null
  parentId: string | null
  /** 게시물 id — 화면이 한 번 만들어 계속 쓴다(멱등) */
  messageId: string
  onSaved: (outcome: CreateDocumentOutcome) => void | Promise<void>
  onCancel: () => void
}) {
  const uploads = useAttachmentUploads({ channelId })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef<File | null>(null)
  const tried = useRef(false)
  const { addFiles, clear } = uploads
  const ready = uploads.items.length === 1 && uploads.uploadIds.length === 1
  const uploadFailed = uploads.items.some(i => i.status === 'error')
  const open = file !== null

  // 파일이 들어오면 한 번만 올리기 시작한다. 닫히면 다음 저장을 위해 초기화
  useEffect(() => {
    if (!file) {
      seeded.current = null
      tried.current = false
      return
    }
    if (seeded.current !== null) return
    seeded.current = file
    tried.current = false
    setError(null)
    addFiles([file])
  }, [file, addFiles])

  const submit = useCallback(async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await createDocument({
        messageId,
        channelId,
        uploadId: uploads.uploadIds[0],
        type,
        fileName,
        folderPath,
        parentId,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      // 서버가 업로드를 확정하고 임시 행도 지웠다 — 목록에서만 뺀다(discardUploads 를 부르지 않는다:
      // 남는 서버 액션이 첫 저장 뒤 주소 교체를 라우터가 되돌리게 만든다)
      uploads.forget(uploads.uploadIds)
      await onSaved(res.data)
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setSaving(false)
    }
  }, [ready, saving, messageId, channelId, uploads, type, fileName, folderPath, parentId, onSaved])

  // 업로드가 끝나면 자동으로 저장(한 번). 실패하면 사용자가 다시 시도한다
  useEffect(() => {
    if (!open || !ready || tried.current) return
    tried.current = true
    void submit()
  }, [open, ready, submit])

  function cancel() {
    if (saving) return
    clear()
    onCancel()
  }

  const failure = error ?? (uploadFailed ? '파일을 올리지 못했습니다.' : null)

  return (
    <Dialog open={open} onOpenChange={next => !next && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 문서를 저장하는 중</DialogTitle>
          <DialogDescription>‘{fileName}’을 이 대화의 파일로 올립니다.</DialogDescription>
        </DialogHeader>
        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {saving ? '저장하는 중…' : '올리는 중…'}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={cancel}>
            취소
          </Button>
          {failure && ready && (
            <Button type="button" disabled={saving} onClick={() => void submit()}>
              다시 시도
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
