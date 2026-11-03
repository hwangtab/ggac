'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { TimebankListingStatus } from '@/constants/timebank'

/**
 * 상세 화면의 글쓴이·관리자 조작(제공·요청 글만 — 조합 업무 글은 관리자 화면 몫).
 * 단추를 보이느냐는 안내일 뿐이고, 판정은 `/api/timebank/listings/[id]`가 한다:
 * 마감·다시 열기·수정은 글쓴이 + 참여 자격(`requireTimebankParticipant`), 삭제는
 * 글쓴이 또는 관리자(꺼짐·미동의여도 된다).
 */
export default function TimebankOwnerControls({
  listingId,
  status,
  isAuthor,
  canWrite,
  canDelete,
}: {
  listingId: string
  status: TimebankListingStatus
  isAuthor: boolean
  /** 현재 참여 자격이 있다(쓰기 판정 ok). 아니면 마감·수정 단추를 숨긴다. */
  canWrite: boolean
  canDelete: boolean
}) {
  const t = useTranslations('timebank.detail')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleStatus = async () => {
    const next: TimebankListingStatus = status === 'open' ? 'closed' : 'open'
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/timebank/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('statusError'))
        return
      }
      router.refresh()
    } catch {
      setError(t('statusError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/timebank/listings/${listingId}`, { method: 'DELETE' })
      if (!response.ok) {
        setError(t('deleteError'))
        return
      }
      router.push('/board/timebank')
      router.refresh()
    } catch {
      setError(t('deleteError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isAuthor && canWrite && (
        <>
          <button
            type="button"
            onClick={() => void toggleStatus()}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {status === 'open' ? t('close') : t('reopen')}
          </button>
          <Link
            href={`/board/timebank/${listingId}/edit`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('edit')}
          </Link>
        </>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {t('delete')}
        </button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
