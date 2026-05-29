'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ReactMarkdown from 'react-markdown'

interface Minutes {
  id: string
  content: string
  content_format: string
  author_id: string
  updated_at: string
}

interface MinutesEditorProps {
  minutes: Minutes | null
  meetingId: string
  currentUserId: string
  isAdmin: boolean
  onChanged: () => void
}

export default function MinutesEditor({
  minutes,
  meetingId,
  currentUserId,
  isAdmin,
  onChanged,
}: MinutesEditorProps) {
  const t = useTranslations('boardRoom.detail')

  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canEdit = minutes ? isAdmin || minutes.author_id === currentUserId : true // any board member can create

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/board-room/minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          content: content.trim(),
          content_format: 'markdown',
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEditing(false)
        setContent('')
        onChanged()
      } else {
        setError(json.error || t('errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!minutes || !content.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-room/minutes/${minutes.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          content_format: 'markdown',
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEditing(false)
        setContent('')
        onChanged()
      } else {
        setError(json.error || t('errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = () => {
    setContent(minutes?.content || '')
    setError(null)
    setEditing(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">{t('minutesHeading')}</h3>
        {!editing && canEdit && minutes && (
          <button
            onClick={startEdit}
            className="text-sm text-primary-600 hover:underline font-medium"
          >
            {t('editMinutes')}
          </button>
        )}
      </div>

      {/* No minutes yet */}
      {!minutes && !editing && (
        <div className="flex flex-col items-start gap-3 p-4 bg-gray-50 border border-dashed border-gray-300 rounded-lg">
          <p className="text-sm text-gray-500">{t('noMinutes')}</p>
          {canEdit && (
            <button
              onClick={() => {
                setContent('')
                setEditing(true)
              }}
              className="text-sm text-primary-600 hover:underline font-medium"
            >
              + {t('writeMinutes')}
            </button>
          )}
        </div>
      )}

      {/* Create / Edit form */}
      {editing && (
        <form onSubmit={minutes ? handleUpdate : handleCreate} className="space-y-3">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t('minutesPlaceholder')}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y font-mono"
            autoFocus
          />
          <p className="text-xs text-gray-400">{t('minutesMarkdownHint')}</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? t('saving') : t('saveMinutes')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              className="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Render existing minutes */}
      {minutes && !editing && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="prose prose-sm max-w-none text-gray-800">
            <ReactMarkdown>{minutes.content}</ReactMarkdown>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            {t('minutesLastUpdated')}: {new Date(minutes.updated_at).toLocaleString('ko-KR')}
          </p>
        </div>
      )}
    </div>
  )
}
