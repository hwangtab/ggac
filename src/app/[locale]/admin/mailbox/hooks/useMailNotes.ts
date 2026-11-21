import { useState, useCallback, type Dispatch, type SetStateAction } from 'react'

import type { InboundEmail, MailboxNote } from '../mailboxTypes'

/** 내부 메모의 작성·고치기·지우기. 메모 목록 자체는 상세 응답이 채우므로 상세 훅이 갖는다. */
export function useMailNotes({
  selectedId,
  notes,
  setNotes,
  setEmails,
}: {
  selectedId: string | null
  notes: MailboxNote[]
  setNotes: Dispatch<SetStateAction<MailboxNote[]>>
  setEmails: Dispatch<SetStateAction<InboundEmail[]>>
}) {
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [editingNote, setEditingNote] = useState<{ id: string; body: string } | null>(null)

  /** 다른 메일을 고르거나 상세를 닫을 때 쓰던 초안을 버린다. */
  const resetNoteDraft = useCallback(() => {
    setNoteDraft('')
    setEditingNote(null)
  }, [])

  // 메모 수는 목록 배지에도 보인다 — 바꾼 뒤 목록 행의 수도 맞춘다.
  const syncNoteCount = (emailId: string, count: number) =>
    setEmails(prev => prev.map(e => (e.id === emailId ? { ...e, note_count: count } : e)))

  const saveNote = async () => {
    if (!selectedId || !noteDraft.trim() || noteSaving) return
    const emailId = selectedId
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/admin/mailbox/${emailId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteDraft }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '메모를 남기지 못했습니다.')
      const next = [...notes, json.data.note as MailboxNote]
      setNotes(next)
      syncNoteCount(emailId, next.length)
      setNoteDraft('')
    } catch (err) {
      alert(err instanceof Error ? err.message : '메모를 남기지 못했습니다.')
    } finally {
      setNoteSaving(false)
    }
  }

  const saveNoteEdit = async () => {
    if (!selectedId || !editingNote || !editingNote.body.trim() || noteSaving) return
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/admin/mailbox/${selectedId}/notes/${editingNote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editingNote.body }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '메모를 고치지 못했습니다.')
      const updated = json.data.note as MailboxNote
      setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)))
      setEditingNote(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : '메모를 고치지 못했습니다.')
    } finally {
      setNoteSaving(false)
    }
  }

  const removeNote = async (note: MailboxNote) => {
    if (!selectedId || noteSaving || !window.confirm('이 메모를 지울까요?')) return
    const emailId = selectedId
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/admin/mailbox/${emailId}/notes/${note.id}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '메모를 지우지 못했습니다.')
      const next = notes.filter(n => n.id !== note.id)
      setNotes(next)
      syncNoteCount(emailId, next.length)
    } catch (err) {
      alert(err instanceof Error ? err.message : '메모를 지우지 못했습니다.')
    } finally {
      setNoteSaving(false)
    }
  }

  return {
    noteDraft,
    setNoteDraft,
    noteSaving,
    editingNote,
    setEditingNote,
    resetNoteDraft,
    saveNote,
    saveNoteEdit,
    removeNote,
  }
}

export type MailNotes = ReturnType<typeof useMailNotes>
