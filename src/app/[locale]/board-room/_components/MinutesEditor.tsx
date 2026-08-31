'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import RichTextEditor from '@/components/RichTextEditor'
import { PostContentRenderer } from '@/components/PostContentRenderer'

interface Minutes {
  id: string
  content: string
  content_format: string
  author_id: string
  updated_at: string
}

type EditorFormat = 'html' | 'markdown'

// Quill의 빈 본문(<p><br></p> 등)이나 공백만 있는 입력을 비어 있는 것으로 처리
function isContentEmpty(value: string): boolean {
  return (
    value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length === 0
  )
}

interface MinutesEditorProps {
  minutes: Minutes | null
  meetingId: string
  currentUserId: string
  isAdmin: boolean
  /** 이사가 아닌 조합원의 열람. 작성·수정 진입점을 모두 감춘다. */
  readOnly?: boolean
  onChanged: () => void
}

export default function MinutesEditor({
  minutes,
  meetingId,
  currentUserId,
  isAdmin,
  readOnly = false,
  onChanged,
}: MinutesEditorProps) {
  const t = useTranslations('boardRoom.detail')

  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState('')
  // 신규 수기 작성은 리치에디터(html), 기존 레코드는 저장된 포맷 그대로 편집(무손실)
  const [format, setFormat] = useState<EditorFormat>('html')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 열람 전용이면 작성 진입점도 없다. 회의록이 아직 없을 때 true로 떨어지는
  // 기본값(= 이사 누구나 작성 가능)이 조합원에게까지 열리지 않게 막는다.
  const canEdit = readOnly ? false : minutes ? isAdmin || minutes.author_id === currentUserId : true // any board member can create

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isContentEmpty(content)) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/board-room/minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          content: content.trim(),
          content_format: format,
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
    if (!minutes || isContentEmpty(content)) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-room/minutes/${minutes.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          content_format: format,
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
    // 기존 레코드는 저장된 포맷 그대로 편집(markdown은 textarea, html은 리치에디터)
    setFormat(minutes?.content_format === 'markdown' ? 'markdown' : 'html')
    setError(null)
    setEditing(true)
  }

  const startCreate = () => {
    setContent('')
    setFormat('html') // 신규 수기 작성은 리치에디터
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
              onClick={startCreate}
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
          {format === 'markdown' ? (
            <>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={t('minutesPlaceholder')}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y font-mono"
                autoFocus
              />
              <p className="text-xs text-gray-400">{t('minutesMarkdownHint')}</p>
            </>
          ) : (
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder={t('minutesPlaceholder')}
              disabled={submitting}
            />
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || isContentEmpty(content)}
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
          <PostContentRenderer
            content={minutes.content}
            contentFormat={(minutes.content_format as 'plain' | 'html' | 'markdown') || 'markdown'}
            className="prose prose-sm max-w-none text-gray-800"
          />
          <p className="text-xs text-gray-400 mt-3">
            {t('minutesLastUpdated')}: {new Date(minutes.updated_at).toLocaleString('ko-KR')}
          </p>
        </div>
      )}
    </div>
  )
}
