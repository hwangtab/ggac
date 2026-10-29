'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { MARKET_STATUSES, type MarketStatus } from '@/constants/market'

/**
 * 상세 화면의 판매자·관리자 조작. 버튼을 보이느냐는 안내일 뿐이고, 실제
 * 판정은 `/api/market/[id]`·`/status`가 한다.
 */
export default function MarketOwnerControls({
  listingId,
  status,
  isSeller,
  canDelete,
}: {
  listingId: string
  status: MarketStatus
  isSeller: boolean
  canDelete: boolean
}) {
  const t = useTranslations('market')
  const router = useRouter()
  const [current, setCurrent] = useState<MarketStatus>(status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeStatus = async (next: MarketStatus) => {
    const previous = current
    setCurrent(next)
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!response.ok) {
        setCurrent(previous)
        setError(t('detail.statusError'))
        return
      }
      router.refresh()
    } catch {
      setCurrent(previous)
      setError(t('detail.statusError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('detail.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}`, { method: 'DELETE' })
      if (!response.ok) {
        setError(t('detail.deleteError'))
        return
      }
      router.push('/board/market')
      router.refresh()
    } catch {
      setError(t('detail.deleteError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isSeller && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            {t('detail.statusLabel')}
            <select
              value={current}
              disabled={busy}
              onChange={e => void changeStatus(e.target.value as MarketStatus)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              {MARKET_STATUSES.map(value => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <Link
            href={`/board/market/${listingId}/edit`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('detail.edit')}
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
          {t('detail.delete')}
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
