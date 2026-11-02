'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { copyAsNewDocument } from '@work/lib/files/create-actions'
import {
  copyDefaultStem,
  fileExtOf,
  normalizeFileNameWithExt,
  type CopyAsNewDocumentOutcome,
} from '@work/lib/files/create-rules'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 사본 만들기 이름 대화상자(docs/16 §6). 기본 이름은 "<원본 이름> 사본.<확장자>", 확장자는 원본으로 고정한다.
 * [만들기] → copyAsNewDocument. 게시물 id 는 열 때마다 한 번 만들어 재시도에 같이 쓴다(멱등).
 */
export default function CopyDocumentDialog({
  open,
  onOpenChange,
  sourceAttachmentId,
  sourceName,
  onCopied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceAttachmentId: string
  sourceName: string
  onCopied: (outcome: CopyAsNewDocumentOutcome, messageId: string) => void
}) {
  const uid = useId()
  const ext = fileExtOf(sourceName)
  const [name, setName] = useState('')
  const [messageId, setMessageId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(copyDefaultStem(sourceName))
    setMessageId(crypto.randomUUID())
    setPending(false)
    setError(null)
  }, [open, sourceName])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const fileName = normalizeFileNameWithExt(name, ext)
    if (!fileName) {
      setError('파일 이름을 입력해 주세요.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await copyAsNewDocument({ messageId, sourceAttachmentId, fileName })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      onCopied(res.data, messageId)
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setPending(false)
    }
  }

  const nameId = `${uid}-name`
  const errId = `${uid}-err`
  return (
    <Dialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={e => void onSubmit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>사본 만들기</DialogTitle>
            <DialogDescription>
              ‘{sourceName}’을 복사해 같은 대화·같은 폴더에 새 파일(v1)로 올립니다. 원본은 그대로
              둡니다.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={nameId}>새 파일 이름</FieldLabel>
            <div className="flex items-center gap-1">
              <Input
                id={nameId}
                value={name}
                disabled={pending}
                onChange={e => {
                  setName(e.target.value)
                  setError(null)
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
                autoFocus
              />
              {ext && (
                <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
                  .{ext}
                </span>
              )}
            </div>
            {error && (
              <p id={errId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '복사하는 중…' : '만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
