import { formatDate } from './mailboxUtils'
import { inputClass, type MailboxNote } from './mailboxTypes'
import type { MailNotes } from './hooks/useMailNotes'

/** 상세 아래의 내부 메모 영역. */
export default function NotesPanel({
  emailId,
  notes,
  viewerId,
  canManage,
  state,
}: {
  emailId: string
  notes: MailboxNote[]
  viewerId: string | null
  canManage: boolean
  state: MailNotes
}) {
  const {
    noteDraft,
    setNoteDraft,
    noteSaving,
    editingNote,
    setEditingNote,
    saveNote,
    saveNoteEdit,
    removeNote,
  } = state

  return (
    <>
      {/*
                      내부 메모 — 이사·감사·관리자 누구나 쓴다. 답장 목록과 같은 이유로 기본은 접는다(펼쳐 두면 본문
                      iframe이 눌린다). 본문은 텍스트로만 그린다 — HTML로 해석하지 않는다.
                    */}
      <details
        key={`notes-${emailId}`}
        data-testid="mail-notes"
        className="shrink-0 border-t border-gray-100 bg-amber-50/40"
      >
        <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-gray-600">
          내부 메모 {notes.length}건{' '}
          <span className="font-normal text-gray-400">
            (이사·감사·관리자만 봅니다. 메일로 나가지 않습니다)
          </span>
        </summary>
        <div className="max-h-60 overflow-y-auto">
          {notes.map(note => {
            const mine = viewerId !== null && note.author_id === viewerId
            const editing = editingNote?.id === note.id
            return (
              <div key={note.id} className="px-4 py-2 border-t border-gray-100 text-xs">
                <div className="flex items-center justify-between gap-2 text-gray-500">
                  <span>
                    <span className="font-medium text-gray-700">
                      {note.author_name ?? '탈퇴한 회원'}
                    </span>{' '}
                    · {note.created_at ? formatDate(note.created_at) : ''}
                    {/* 삽입 때 두 시각이 따로 찍혀 몇 ms 어긋날 수 있다 — 1초 넘게 차이 날 때만 고친 것으로 본다. */}
                    {note.updated_at &&
                      note.created_at &&
                      Date.parse(note.updated_at) - Date.parse(note.created_at) > 1000 &&
                      ' (수정됨)'}
                  </span>
                  {!editing && (mine || canManage) && (
                    <span className="flex gap-2 shrink-0">
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setEditingNote({ id: note.id, body: note.body })}
                          className="hover:text-gray-800"
                        >
                          고치기
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeNote(note)}
                        className="hover:text-red-700"
                      >
                        지우기
                      </button>
                    </span>
                  )}
                </div>
                {editing ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      rows={3}
                      value={editingNote.body}
                      onChange={e => setEditingNote({ id: note.id, body: e.target.value })}
                      maxLength={2000}
                      aria-label="메모 고치기"
                      className={`${inputClass} resize-none text-xs`}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingNote(null)}
                        className="px-2 py-1 text-gray-600 hover:text-gray-900"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={noteSaving || !editingNote.body.trim()}
                        onClick={saveNoteEdit}
                        className="px-2 py-1 rounded bg-gray-800 text-white disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">
                    {note.body}
                  </p>
                )}
              </div>
            )
          })}
          <div className="px-4 py-2 border-t border-gray-100 space-y-1">
            <textarea
              rows={2}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              maxLength={2000}
              placeholder="이 메일에 대해 함께 볼 메모를 남기세요."
              aria-label="새 메모"
              className={`${inputClass} resize-none text-xs`}
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={noteSaving || !noteDraft.trim()}
                onClick={saveNote}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                메모 남기기
              </button>
            </div>
          </div>
        </div>
      </details>
    </>
  )
}
