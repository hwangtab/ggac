'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { intlLocale } from '@/utils/intlLocale'
import { SEOUL_TIME_ZONE } from '@/utils/date'
import { MARKET_COMMENT_MAX } from '@/constants/market'
import type { MarketCommentRow } from '@/db/queries/market'

/**
 * 장터 문의 댓글. 첫 목록은 서버가 렌더해 내려주고, 쓰기·삭제 뒤에만 다시 읽는다.
 */
export default function MarketComments({
  listingId,
  sellerId,
  viewerId,
  isAdmin,
  initialComments,
}: {
  listingId: string
  sellerId: string
  viewerId: string
  isAdmin: boolean
  initialComments: MarketCommentRow[]
}) {
  const t = useTranslations('market')
  const dateLocale = intlLocale(useLocale())
  const [comments, setComments] = useState(initialComments)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    const response = await fetch(`/api/market/${listingId}/comments`, { cache: 'no-store' })
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
      const response = await fetch(`/api/market/${listingId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('comments.error'))
        return
      }
      setContent('')
      await reload()
    } catch {
      setError(t('comments.error'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (commentId: string) => {
    if (!window.confirm(t('comments.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}/comments/${commentId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setError(t('comments.error'))
        return
      }
      await reload()
    } catch {
      setError(t('comments.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 rounded-lg bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-800">{t('comments.heading')}</h2>

      {comments.length === 0 ? (
        <p className="mb-4 text-sm text-gray-500">{t('comments.empty')}</p>
      ) : (
        <ul className="mb-6 space-y-4">
          {comments.map(comment => (
            <li key={comment.id} className="border-b border-gray-100 pb-3 last:border-0">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{comment.author_name}</span>
                {comment.author_id === sellerId && (
                  <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
                    {t('comments.seller')}
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
                    {t('comments.delete')}
                  </button>
                )}
              </div>
              {comment.is_deleted ? (
                <p className="text-sm italic text-gray-400">{t('comments.deleted')}</p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-gray-700">
                  {comment.content}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          maxLength={MARKET_COMMENT_MAX}
          placeholder={t('comments.placeholder')}
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
            {t('comments.submit')}
          </button>
        </div>
      </form>
    </section>
  )
}
