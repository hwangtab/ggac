'use client'

import { useEffect, useState } from 'react'
import { SectionHeading } from '@work/components/layout/page'
import { Loader2Icon } from 'lucide-work'
import { CHAT_PROSE_CLASS } from '@work/components/chat/ChatMarkdown'
import MessageMarkdown from '@work/components/markdown/MessageMarkdown'
import { Badge } from '@work/components/ui/badge'
import { Button } from '@work/components/ui/button'
import { getNoteRevision, listNoteRevisions } from '@work/lib/notes/actions'
import type { NoteData, NoteRevision, NoteRevisionMeta } from '@work/lib/notes/schema'
import { formatDateTime } from '@work/lib/format/datetime'
import NoteDiff from './NoteDiff'

/**
 * 메모 이력 — 저장된 버전 목록, 한 버전 보기, 현재와 비교, 되돌리기.
 * 되돌리기는 그 버전의 본문을 **새 버전**으로 저장한다(이력은 지워지지 않는다). 읽기 전용 사용자에게는 되돌리기 단추가 없다.
 */
export default function NoteHistoryPanel({
  note,
  canEdit,
  onRevert,
  onClose,
  busy,
}: {
  note: NoteData
  canEdit: boolean
  /** 되돌리기 — 실패 문구가 있으면 돌려준다 */
  onRevert: (version: number) => Promise<string | null>
  onClose: () => void
  busy: boolean
}) {
  const [list, setList] = useState<NoteRevisionMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<NoteRevision | null>(null)
  const [loadingVersion, setLoadingVersion] = useState<number | null>(null)
  const [compare, setCompare] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // 현재 버전이 바뀌면(내가 되돌렸거나 다른 사람이 저장) 목록을 다시 읽는다
  useEffect(() => {
    let cancelled = false
    void listNoteRevisions({ noteId: note.id })
      .then(res => {
        if (cancelled) return
        if (res.ok) {
          setList(res.data)
          setError(null)
        } else setError(res.error)
      })
      .catch(() => {
        if (!cancelled) setError('이력을 불러오지 못했습니다.')
      })
    return () => {
      cancelled = true
    }
  }, [note.id, note.version])

  async function open(version: number) {
    setLoadingVersion(version)
    setError(null)
    setCompare(false)
    setConfirming(false)
    try {
      const res = await getNoteRevision({ noteId: note.id, version })
      if (res.ok) setPicked(res.data)
      else setError(res.error)
    } catch {
      setError('버전을 불러오지 못했습니다.')
    } finally {
      setLoadingVersion(null)
    }
  }

  async function revert() {
    if (!picked) return
    const why = await onRevert(picked.version)
    if (why) setError(why)
    else {
      setPicked(null)
      setConfirming(false)
    }
  }

  return (
    <section aria-label="메모 이력" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <SectionHeading
        actions={
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            메모로 돌아가기
          </Button>
        }
      >
        저장 이력
      </SectionHeading>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {list === null && !error ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          불러오는 중…
        </p>
      ) : (
        <ul className="grid gap-1" aria-label="버전 목록">
          {(list ?? []).map(r => {
            const current = r.version === note.version
            const active = picked?.version === r.version
            return (
              <li key={r.version}>
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={loadingVersion !== null}
                  onClick={() => void open(r.version)}
                  className={`flex w-full flex-wrap items-center gap-2 min-h-10 rounded-w-lg border px-4 py-1.5 text-left text-sm outline-none hover:bg-accent ${active ? 'border-primary bg-subtle' : ''}`}
                >
                  <span className="font-medium">버전 {r.version}</span>
                  {current && <Badge variant="secondary">현재</Badge>}
                  <span className="text-muted-foreground">
                    {r.editedByName ?? '알 수 없음'} · {formatDateTime(r.editedAt)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {picked && (
        <div className="grid gap-2 rounded-w-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">
              버전 {picked.version} · {picked.editedByName ?? '알 수 없음'} ·{' '}
              {formatDateTime(picked.editedAt)}
            </h3>
            <div className="ml-auto flex flex-wrap gap-1">
              {picked.version !== note.version && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={compare}
                  onClick={() => setCompare(c => !c)}
                >
                  현재와 비교
                </Button>
              )}
              {canEdit && picked.version !== note.version && (
                <Button type="button" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                  이 버전으로 되돌리기
                </Button>
              )}
            </div>
          </div>
          {confirming && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                버전 {picked.version} 의 내용을 새 버전으로 저장합니다. 지금 내용도 이력에 남습니다.
              </span>
              <Button type="button" size="sm" disabled={busy} onClick={() => void revert()}>
                되돌리기
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                취소
              </Button>
            </div>
          )}
          {compare ? (
            <NoteDiff
              from={picked.body}
              to={note.body}
              fromLabel={`버전 ${picked.version}`}
              toLabel={`현재(버전 ${note.version})`}
            />
          ) : picked.body.trim() ? (
            <MessageMarkdown content={picked.body} className={`prose-p:my-2 ${CHAT_PROSE_CLASS}`} />
          ) : (
            <p className="text-sm text-muted-foreground">내용이 비어 있는 버전입니다.</p>
          )}
        </div>
      )}
    </section>
  )
}
