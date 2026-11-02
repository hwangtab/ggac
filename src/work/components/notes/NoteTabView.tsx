'use client'

import { useEffect, useState } from 'react'
import { EmptyState } from '@work/components/layout/page'
import { useRouter } from '@work/lib/nav/navigation'
import { HistoryIcon, PencilIcon } from 'lucide-work'
import { CHAT_PROSE_CLASS } from '@work/components/chat/ChatMarkdown'
import MessageMarkdown from '@work/components/markdown/MessageMarkdown'
import { Button } from '@work/components/ui/button'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import { revertNote, saveNote } from '@work/lib/notes/actions'
import type { NoteData } from '@work/lib/notes/schema'
import { formatDateTime } from '@work/lib/format/datetime'
import NoteDiff from './NoteDiff'
import NoteEditor from './NoteEditor'
import NoteHistoryPanel from './NoteHistoryPanel'
import EditableNoteMarkdown, { type TableSaveResult } from './NoteTableEditing'

type Mode = 'view' | 'edit' | 'history'

/**
 * 메모 탭 본문(docs/05 §4-5). 보기 / 편집 / 이력 세 화면.
 * 낙관적 잠금: 편집을 시작한 시점의 버전(baseVersion)으로 저장하고, 그 사이 다른 사람이 저장했다면
 * 저장이 거절되어 "다른 사람이 먼저 고쳤습니다 — 차이 보기 / 내 것으로 덮어쓰기 / 취소"를 보여 준다.
 * 덮어쓰기는 최신 버전을 기준으로 새 버전을 만든다(상대 버전은 이력에 남는다).
 */
export default function NoteTabView({ note, canEdit }: { note: NoteData; canEdit: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState(note.body)
  const [baseVersion, setBaseVersion] = useState(note.version)
  const [conflict, setConflict] = useState<NoteData | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const dirty = mode === 'edit' && draft !== note.body
  // 편집 중 다른 사람이 저장해 서버 렌더가 새 버전을 내려줬다
  const staleWhileEditing = mode === 'edit' && note.version !== baseVersion && !conflict

  // 저장하지 않은 편집 내용이 있으면 탭을 닫을 때 경고
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function startEdit() {
    setDraft(note.body)
    setBaseVersion(note.version)
    setConflict(null)
    setShowDiff(false)
    setError(null)
    setMode('edit')
  }

  function cancelEdit() {
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    exitEdit()
  }

  function exitEdit() {
    setConflict(null)
    setError(null)
    setMode('view')
  }

  async function save(expectedVersion: number) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveNote({ noteId: note.id, expectedVersion, body: draft })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.data.status === 'conflict') {
        setConflict(res.data.latest)
        setShowDiff(false)
        return
      }
      setConflict(null)
      setMode('view')
      setStatus('저장했습니다.')
      router.refresh()
    } catch {
      setError('네트워크 문제로 저장하지 못했습니다. 입력한 내용은 그대로 있습니다.')
    } finally {
      setSaving(false)
    }
  }

  /** 보기 화면에서 표 행을 더하거나 고치거나 지울 때: 지금 버전을 기준으로 저장(낙관적 잠금). */
  async function saveFromTable(nextBody: string): Promise<TableSaveResult> {
    try {
      const res = await saveNote({
        noteId: note.id,
        expectedVersion: note.version,
        body: nextBody,
      })
      if (!res.ok) return { status: 'error', message: res.error }
      if (res.data.status === 'conflict') {
        setStatus(null)
        setError('그 사이 다른 사람이 먼저 고쳤습니다. 최신 내용을 불러왔으니 다시 시도해 주세요.')
        router.refresh()
        return { status: 'conflict' }
      }
      setError(null)
      setStatus('저장했습니다.')
      router.refresh()
      return { status: 'saved' }
    } catch {
      return { status: 'error', message: '네트워크 문제로 저장하지 못했습니다.' }
    }
  }

  async function revert(version: number): Promise<string | null> {
    setSaving(true)
    try {
      const res = await revertNote({
        noteId: note.id,
        expectedVersion: note.version,
        toVersion: version,
      })
      if (!res.ok) return res.error
      if (res.data.status === 'conflict') {
        router.refresh()
        return '그 사이 다른 사람이 저장했습니다. 최신 이력을 다시 확인해 주세요.'
      }
      setStatus(`버전 ${version} 의 내용으로 되돌렸습니다.`)
      router.refresh()
      return null
    } catch {
      return '네트워크 문제로 되돌리지 못했습니다.'
    } finally {
      setSaving(false)
    }
  }

  const meta = (
    <p className="text-xs text-muted-foreground">
      버전 {note.version}
      {note.updatedByName ? ` · ${note.updatedByName}` : ''} · {formatDateTime(note.updatedAt)} 저장
    </p>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <ConfirmDialog
        open={discardOpen}
        title="편집을 그만둘까요?"
        description="저장하지 않은 변경이 사라지고, 마지막으로 저장된 메모로 돌아갑니다."
        confirmLabel="변경 버리기"
        cancelLabel="계속 편집"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false)
          exitEdit()
        }}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>

      {mode === 'history' ? (
        <NoteHistoryPanel
          note={note}
          canEdit={canEdit}
          busy={saving}
          onRevert={revert}
          onClose={() => setMode('view')}
        />
      ) : mode === 'view' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {meta}
            <div className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setMode('history')}>
                <HistoryIcon aria-hidden="true" />
                이력
              </Button>
              {canEdit && (
                <Button type="button" size="sm" onClick={startEdit}>
                  <PencilIcon aria-hidden="true" />
                  편집
                </Button>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {note.body.trim() ? (
            canEdit ? (
              <EditableNoteMarkdown
                body={note.body}
                className={`prose-p:my-2 ${CHAT_PROSE_CLASS}`}
                onSave={saveFromTable}
              />
            ) : (
              <MessageMarkdown content={note.body} className={`prose-p:my-2 ${CHAT_PROSE_CLASS}`} />
            )
          ) : (
            <EmptyState
              as="p"
              title="아직 내용이 없습니다"
              description={
                canEdit
                  ? '이 대화 멤버가 함께 쓰는 메모입니다. 편집을 눌러 시작하세요.'
                  : '아직 작성된 내용이 없습니다.'
              }
            />
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {meta}
            <div className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !dirty || conflict !== null}
                onClick={() => void save(baseVersion)}
              >
                {saving ? '저장하는 중…' : '저장'}
              </Button>
            </div>
          </div>

          {staleWhileEditing && (
            <p role="alert" className="rounded-w-md bg-muted px-3 py-2 text-sm">
              편집하는 동안 다른 사람이 저장했습니다(현재 버전 {note.version}). 지금 저장하면 충돌을
              확인하는 화면이 나옵니다.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {conflict && (
            <div role="alert" className="grid gap-2 rounded-w-lg border border-destructive/30 p-3">
              <p className="text-sm font-medium">다른 사람이 먼저 고쳤습니다</p>
              <p className="text-sm text-muted-foreground">
                {conflict.updatedByName ?? '다른 사람'}이(가) {formatDateTime(conflict.updatedAt)}에
                버전 {conflict.version} 으로 저장했습니다. 내가 쓴 내용으로 덮어쓰면 그 버전은
                이력에만 남습니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={showDiff}
                  onClick={() => setShowDiff(v => !v)}
                >
                  차이 보기
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={saving}
                  onClick={() => void save(conflict.version)}
                >
                  내 것으로 덮어쓰기
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setConflict(null)
                    setShowDiff(false)
                  }}
                >
                  취소
                </Button>
              </div>
              {showDiff && (
                <NoteDiff
                  from={conflict.body}
                  to={draft}
                  fromLabel={`다른 사람의 최신 내용(버전 ${conflict.version})`}
                  toLabel="내가 쓴 내용"
                />
              )}
            </div>
          )}

          <NoteEditor
            value={draft}
            onChange={setDraft}
            onSave={() => {
              if (dirty && !conflict) void save(baseVersion)
            }}
            disabled={saving}
          />
        </>
      )}
    </div>
  )
}
