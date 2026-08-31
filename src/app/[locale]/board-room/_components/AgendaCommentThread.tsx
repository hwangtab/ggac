'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MAX_AGENDA_COMMENT_LENGTH } from '@/constants/boardRoom'

interface AgendaComment {
  id: string
  author_id: string
  author_name: string
  author_title: string | null
  content: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
}

interface AgendaCommentThreadProps {
  agendaId: string
  commentCount: number
  currentUserId: string
  isAdmin: boolean
  /** 이사가 아닌 조합원의 열람. 의견 작성 폼과 삭제 버튼을 감춘다. */
  readOnly?: boolean
  /** 댓글 수 배지를 다시 계산하도록 회의 상세를 새로 받는다. */
  onCountChanged: () => void
}

/**
 * 수정 배지 판정. `created_at`과 `updated_at`은 INSERT 때 각각 `new Date()`를
 * 따로 부르므로 밀리초 경계에서 갈릴 수 있다 — 엄밀 비교(`!==`)를 쓰면 아무도
 * 고치지 않은 댓글에 "(수정됨)"이 붙는다. 1초 여유를 둔다.
 */
function wasEdited(comment: AgendaComment) {
  return new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1000
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AgendaCommentThread({
  agendaId,
  commentCount,
  currentUserId,
  isAdmin,
  readOnly = false,
  onCountChanged,
}: AgendaCommentThreadProps) {
  const t = useTranslations('boardRoom.discussion')

  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<AgendaComment[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // 요청 세대. 느린 GET이 나중에 도착해 최신 목록을 덮어쓰는 것을 막는다 —
  // 그 덮어쓰기가 일어나면 방금 등록에 성공한 내 댓글이 화면에서 사라진다.
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}/comments`)
      const json = await res.json()
      if (seq !== requestSeq.current) return
      if (json.success) {
        setComments(json.data.comments)
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      if (seq === requestSeq.current) setError(t('error'))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [agendaId, t])

  // 펼칠 때마다 새로 받는다. 첫 로드에서만 받으면 접었다 펴는(= 사용자가
  // 새로고침이라고 여기는) 동작으로도 남의 새 발언이 보이지 않는다.
  //
  // effect가 아니라 클릭 핸들러에서 부른다. `[open, load]` effect로 쓰면
  // `load`가 `useTranslations`의 `t`에 의존해 렌더마다 새 함수가 되고, 그
  // 자체가 다시 렌더를 부르는 무한 요청이 된다.
  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const json = await res.json()
      if (json.success) {
        setDraft('')
        await load()
        onCountChanged()
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      setError(t('error'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditSave = async (commentId: string) => {
    const content = editDraft.trim()
    if (!content) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const json = await res.json()
      if (json.success) {
        setEditingId(null)
        await load()
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      setError(t('error'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (commentId: string) => {
    if (!confirm(t('deleteConfirm'))) return
    setError(null)
    try {
      const res = await fetch(`/api/board-room/agendas/${agendaId}/comments/${commentId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        await load()
        onCountChanged()
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      setError(t('error'))
    }
  }

  const liveComments = comments?.filter(c => !c.is_deleted)
  const visibleCount = liveComments ? liveComments.length : commentCount

  return (
    <div className="mt-3 pl-5 border-t border-gray-100 pt-2">
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs text-gray-500 hover:text-primary-600 font-medium"
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {t('toggle', { count: visibleCount })}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading && <p className="text-xs text-gray-400">{t('loading')}</p>}

          {liveComments && liveComments.length === 0 && !loading && (
            <p className="text-xs text-gray-500 italic">{t('empty')}</p>
          )}

          {comments?.map(comment => (
            <div key={comment.id} className="text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{comment.author_name}</span>
                {comment.author_title && (
                  <span className="text-xs text-gray-500">{comment.author_title}</span>
                )}
                <span className="text-xs text-gray-400">{formatTimestamp(comment.created_at)}</span>
                {!comment.is_deleted && wasEdited(comment) && (
                  <span className="text-xs text-gray-400">{t('edited')}</span>
                )}
                {!comment.is_deleted && editingId !== comment.id && (
                  <span className="flex items-center gap-2 ml-auto">
                    {comment.author_id === currentUserId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(comment.id)
                          setEditDraft(comment.content || '')
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t('edit')}
                      </button>
                    )}
                    {!readOnly && (comment.author_id === currentUserId || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        {t('delete')}
                      </button>
                    )}
                  </span>
                )}
              </div>

              {comment.is_deleted ? (
                <p className="text-sm text-gray-400 italic mt-0.5">{t('deleted')}</p>
              ) : editingId === comment.id ? (
                <div className="mt-1 space-y-2">
                  <textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    rows={3}
                    maxLength={MAX_AGENDA_COMMENT_LENGTH}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditSave(comment.id)}
                      disabled={submitting || !editDraft.trim()}
                      className="px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap mt-0.5">
                  {comment.content}
                </p>
              )}
            </div>
          ))}

          {error && <p className="text-xs text-red-600">{error}</p>}

          {!readOnly && (
            <form onSubmit={handleSubmit} className="space-y-2">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={t('placeholder')}
                rows={2}
                maxLength={MAX_AGENDA_COMMENT_LENGTH}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !draft.trim()}
                  className="px-4 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? t('sending') : t('send')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
