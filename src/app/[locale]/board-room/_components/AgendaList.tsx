'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import AgendaCommentThread from './AgendaCommentThread'
import { BOARD_AGENDA_STATUS } from '@/constants/boardRoom'
import type { BoardAgendaStatus } from '@/constants/boardRoom'

interface Agenda {
  id: string
  title: string
  content: string | null
  sort_order: number
  status: BoardAgendaStatus
  proposed_by: string
  created_at: string
  comment_count?: number
}

interface AgendaListProps {
  agendas: Agenda[]
  currentUserId: string
  isAdmin: boolean
  meetingId: string
  onChanged: () => void
  /**
   * 이사가 아닌 조합원이 열람만 하는 경우. 안건 추가·수정·삭제와 토론 작성을
   * 감춘다. 실제 차단은 API(`requireBoardMember`)가 하고, 여기서는 눌러도
   * 403이 나는 버튼을 보여주지 않는다.
   */
  readOnly?: boolean
}

const agendaStatusStyles: Record<BoardAgendaStatus, string> = {
  proposed: 'bg-amber-100 text-amber-800 border-amber-200',
  discussed: 'bg-blue-100 text-blue-800 border-blue-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
}

export default function AgendaList({
  agendas,
  currentUserId,
  isAdmin,
  meetingId,
  onChanged,
  readOnly = false,
}: AgendaListProps) {
  const t = useTranslations('boardRoom.detail')
  const tStatus = useTranslations('boardRoom.agendaStatus')

  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const sortedAgendas = [...agendas].sort((a, b) => a.sort_order - b.sort_order)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setSubmitting(true)
    setAddError(null)
    try {
      const res = await fetch('/api/board-room/agendas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          title: newTitle.trim(),
          content: newContent.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setNewTitle('')
        setNewContent('')
        setAdding(false)
        onChanged()
      } else {
        setAddError(json.error || t('errorGeneric'))
      }
    } catch {
      setAddError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (agendaId: string, status: BoardAgendaStatus) => {
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (json.success) onChanged()
    } catch {
      // silently fail — user can retry
    }
  }

  const handleDelete = async (agendaId: string) => {
    if (!confirm(t('deleteAgendaConfirm'))) return
    setDeleteError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        onChanged()
      } else {
        // 거절 사유를 반드시 보여준다. 토론이 붙은 안건은 관리자만 지울 수
        // 있는데(라우트의 403), 조용히 삼키면 삭제 버튼이 먹통으로 보인다 —
        // 특히 남이 썼다 지운 의견만 남은 안건은 배지가 '토론 0'이라 이유를
        // 짐작할 단서조차 화면에 없다.
        setDeleteError(json.error || t('errorGeneric'))
      }
    } catch {
      setDeleteError(t('errorGeneric'))
    }
  }

  const startEdit = (agenda: Agenda) => {
    setEditingId(agenda.id)
    setEditTitle(agenda.title)
    setEditContent(agenda.content || '')
    setEditError(null)
  }

  const handleEditSave = async (agendaId: string) => {
    if (!editTitle.trim()) return
    setEditSubmitting(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          content: editContent.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEditingId(null)
        onChanged()
      } else {
        setEditError(json.error || t('errorGeneric'))
      }
    } catch {
      setEditError(t('errorGeneric'))
    } finally {
      setEditSubmitting(false)
    }
  }

  const canControl = (agenda: Agenda) =>
    !readOnly && (isAdmin || agenda.proposed_by === currentUserId)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">{t('agendaHeading')}</h3>
        {!adding && !readOnly && (
          <button
            onClick={() => setAdding(true)}
            className="text-sm text-primary-600 hover:underline font-medium"
          >
            + {t('addAgenda')}
          </button>
        )}
      </div>

      {/* Add agenda form */}
      {adding && (
        <form
          onSubmit={handleAdd}
          className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3"
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {t('agendaTitle')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={t('agendaTitlePlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {t('agendaContent')}
            </label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder={t('agendaContentPlaceholder')}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !newTitle.trim()}
              className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? t('saving') : t('save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setAddError(null)
                setNewTitle('')
                setNewContent('')
              }}
              className="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {deleteError && <p className="mb-3 text-xs text-red-600">{deleteError}</p>}

      {sortedAgendas.length === 0 && !adding ? (
        <p className="text-sm text-gray-500 italic py-2">{t('noAgendas')}</p>
      ) : (
        <div className="space-y-3">
          {sortedAgendas.map((agenda, idx) => (
            <div key={agenda.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              {editingId === agenda.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  />
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditSave(agenda.id)}
                      disabled={editSubmitting || !editTitle.trim()}
                      className="px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {editSubmitting ? t('saving') : t('save')}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null)
                        setEditError(null)
                      }}
                      className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 shrink-0">{idx + 1}.</span>
                      <h4 className="text-sm font-semibold text-gray-900 truncate">
                        {agenda.title}
                      </h4>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${agendaStatusStyles[agenda.status]}`}
                      >
                        {tStatus(agenda.status)}
                      </span>
                    </div>
                    {canControl(agenda) && (
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={agenda.status}
                          onChange={e =>
                            handleStatusChange(agenda.id, e.target.value as BoardAgendaStatus)
                          }
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                        >
                          {BOARD_AGENDA_STATUS.map(s => (
                            <option key={s} value={s}>
                              {tStatus(s)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => startEdit(agenda)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {t('edit')}
                        </button>
                        <button
                          onClick={() => handleDelete(agenda.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          {t('deleteAgenda')}
                        </button>
                      </div>
                    )}
                  </div>
                  {agenda.content && (
                    <p className="text-sm text-gray-600 mt-1 pl-5 whitespace-pre-wrap">
                      {agenda.content}
                    </p>
                  )}
                </div>
              )}
              {/* 삼항 **바깥**에 둔다. 안에 두면 같은 안건의 수정 버튼을 누르는
                  순간 스레드가 통째로 언마운트돼 쓰던 의견 초안이 사라진다. */}
              <AgendaCommentThread
                agendaId={agenda.id}
                commentCount={agenda.comment_count ?? 0}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onCountChanged={onChanged}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
