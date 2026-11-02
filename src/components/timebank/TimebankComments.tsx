'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { intlLocale } from '@/utils/intlLocale'
import { SEOUL_TIME_ZONE } from '@/utils/date'
import { TIMEBANK_COMMENT_MAX } from '@/constants/timebank'
import type { TimebankCommentRow } from '@/db/queries/timebankBoard'

/**
 * 타임뱅크 글 댓글 — 약속·일정을 정하는 자리(스펙 §5). 첫 목록은 서버가 렌더해
 * 내려주고, 쓰기·삭제 뒤에만 다시 읽는다. 쓰기는 참여자만(`canWrite`), 삭제는
 * 댓글 쓴이 또는 관리자(꺼짐·미동의여도 된다 — API와 같다).
 */
export default function TimebankComments({
  listingId,
  authorId,
  viewerId,
  isAdmin,
  canWrite,
  initialComments,
}: {
  listingId: string
  /** 글쓴이 id — 그 사람의 댓글에 "글쓴이" 표시를 단다. */
  authorId: string
  viewerId: string
  isAdmin: boolean
  canWrite: boolean
  initialComments: TimebankCommentRow[]
}) {
  const t = useTranslations('timebank.comments')
  const dateLocale = intlLocale(useLocale())
  const [comments, setComments] = useState(initialComments)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    const response = await fetch(`/api/timebank/listings/${listingId}/comments`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('load')
    const json = await response.json()
    setComments(json?.data?.comments ?? [])
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/timebank/listings/${listingId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('error'))
        return
      }
      setContent('')
      await reload()
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (commentId: string) => {
    if (!window.confirm(t('deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/timebank/listings/${listingId}/comments/${commentId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setError(t('error'))
        return
      }
      await reload()
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 rounded-lg bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-800">{t('heading')}</h2>

      {comments.length === 0 ? (
        <p className="mb-4 text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="mb-6 space-y-4">
          {comments.map(comment => (
            <li key={comment.id} className="border-b border-gray-100 pb-3 last:border-0">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{comment.author_name}</span>
                {comment.author_id === authorId && (
                  <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
                    {t('author')}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date(comment.created_at).toLocaleString(dateLocale, {
                    ...SEOUL_TIME_ZONE,
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {!comment.is_deleted && (comment.author_id === viewerId || isAdmin) && (
                  <button
                    type="button"
                    onClick={() => void remove(comment.id)}
                    disabled={busy}
                    className="ml-auto text-xs text-gray-400 hover:text-red-600"
                  >
                    {t('delete')}
                  </button>
                )}
              </div>
              {comment.is_deleted ? (
                <p className="text-sm italic text-gray-400">{t('deleted')}</p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-gray-700">
                  {comment.content}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={submit} className="space-y-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            maxLength={TIMEBANK_COMMENT_MAX}
            placeholder={t('placeholder')}
            className="min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !content.trim()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {t('submit')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <p className="text-sm text-gray-500">{t('readOnly')}</p>
        </>
      )}
    </section>
  )
}
