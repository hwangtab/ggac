'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { intlLocale } from '@/utils/intlLocale'
import { SEOUL_TIME_ZONE } from '@/utils/date'
import type { PublicAuction, PublicBid } from '@/lib/market/auctionView'
import { MARKET_AUCTION_DURATIONS } from '@/constants/market'

/**
 * 경매 상세의 입찰 칸. 첫 상태는 서버가 렌더해 내려주고, 입찰·무효 처리 뒤에는
 * `router.refresh()`로 서버가 다시 그린다(현재가·마감·이력을 한 곳에서만 계산).
 *
 * 카운트다운은 **안내**다. 마감 판정은 서버 시각으로 `placeBid`가 한다 — 화면
 * 시계가 틀려도 마감 뒤 입찰은 들어가지 않는다.
 */
export default function AuctionPanel({
  listingId,
  auction,
  bids,
  isSeller,
  isAdmin,
}: {
  listingId: string
  auction: PublicAuction
  bids: PublicBid[]
  isSeller: boolean
  isAdmin: boolean
}) {
  const t = useTranslations('market')
  const locale = useLocale()
  const dateLocale = intlLocale(locale)
  const router = useRouter()
  const [amount, setAmount] = useState(String(auction.next_minimum))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)

  // 서버 렌더와 첫 하이드레이션이 같은 HTML을 내도록 시계는 마운트 뒤에 켠다.
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setAmount(String(auction.next_minimum))
  }, [auction.next_minimum])

  const won = (n: number) =>
    t('price.won', { price: n.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR') })
  const endsAt = new Date(auction.ends_at).getTime()
  const live = auction.state === 'live' && (now === null || now < endsAt)

  const remaining = (() => {
    if (now === null) return ''
    const ms = Math.max(0, endsAt - now)
    const s = Math.floor(ms / 1000)
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return d > 0
      ? t('auction.countdownDays', { d, hms: `${pad(h)}:${pad(m)}:${pad(sec)}` })
      : `${pad(h)}:${pad(m)}:${pad(sec)}`
  })()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('auction.bidError'))
      }
      router.refresh()
    } catch {
      setError(t('auction.bidError'))
    } finally {
      setBusy(false)
    }
  }

  // 유찰된 경매 다시 열기(판매자). 입찰이 하나도 없었으니 같은 매물에서 새로 시작한다.
  const [relistStart, setRelistStart] = useState(String(auction.start_price))
  const [relistIncrement, setRelistIncrement] = useState(String(auction.min_increment))
  const [relistDays, setRelistDays] = useState('3')
  const relist = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}/relist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_price: relistStart,
          min_increment: relistIncrement,
          duration_days: relistDays,
        }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('auction.bidError'))
      }
      router.refresh()
    } catch {
      setError(t('auction.bidError'))
    } finally {
      setBusy(false)
    }
  }

  const voidBid = async (bidId: string) => {
    if (!window.confirm(t('auction.voidConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/market/${listingId}/bids/${bidId}`, { method: 'DELETE' })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('auction.bidError'))
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-orange-200 bg-orange-50 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-orange-800">
            {auction.state === 'ended'
              ? t('auction.winningPrice')
              : auction.current_price === null
                ? t('auction.startPrice')
                : t('auction.currentPrice')}
          </p>
          <p className="text-3xl font-bold text-gray-900">
            {won(auction.current_price ?? auction.start_price)}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {[
              t('auction.bidCount', { count: auction.bid_count }),
              t('auction.increment', { amount: won(auction.min_increment) }),
            ].join(' · ')}
          </p>
        </div>
        <div className="sm:text-right">
          {live ? (
            <>
              <p className="text-sm text-orange-800">{t('auction.remaining')}</p>
              <p
                className="font-mono text-2xl font-semibold text-gray-900"
                suppressHydrationWarning
              >
                {remaining || '—'}
              </p>
            </>
          ) : (
            <p className="text-lg font-semibold text-gray-700">
              {t(`auction.state.${auction.state === 'live' ? 'ended' : auction.state}`)}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            {t('auction.endsAt')}{' '}
            {new Date(auction.ends_at).toLocaleString(dateLocale, {
              ...SEOUL_TIME_ZONE,
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {auction.state === 'ended' && auction.winner_name && (
        <div className="mt-4 rounded-lg bg-white p-3 text-sm text-gray-800">
          <p>
            {auction.i_won
              ? t('auction.youWon')
              : t('auction.winnerLine', { name: auction.winner_name })}
          </p>
          {isSeller && <p className="mt-2 text-xs text-gray-600">{t('auction.noShowHint')}</p>}
        </div>
      )}

      {live && auction.i_am_leading && (
        <p className="mt-4 rounded-lg bg-white p-3 text-sm font-medium text-emerald-700">
          {t('auction.youAreLeading')}
        </p>
      )}

      {auction.state === 'no_bids' && isSeller && (
        <form onSubmit={relist} className="mt-4 rounded-lg bg-white p-3 text-sm">
          <p className="mb-2 font-medium text-gray-800">{t('auction.relistTitle')}</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col text-xs text-gray-600">
              {t('form.startPrice')}
              <input
                inputMode="numeric"
                value={relistStart}
                onChange={e => setRelistStart(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-1 w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              {t('form.minIncrement')}
              <input
                inputMode="numeric"
                value={relistIncrement}
                onChange={e => setRelistIncrement(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-1 w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              {t('form.duration')}
              <select
                value={relistDays}
                onChange={e => setRelistDays(e.target.value)}
                className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {MARKET_AUCTION_DURATIONS.map(days => (
                  <option key={days} value={days}>
                    {t('form.durationDays', { count: days })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="self-end rounded-lg bg-orange-600 px-4 py-1.5 text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {t('auction.relistButton')}
            </button>
          </div>
        </form>
      )}

      {live && !isSeller && (
        <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="bid-amount">
            {t('auction.amountLabel')}
          </label>
          <input
            id="bid-amount"
            inputMode="numeric"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))}
            className="w-40 flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-orange-600 px-5 py-2 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {t('auction.bidButton')}
          </button>
          <p className="w-full text-xs text-gray-600">
            {t('auction.minimumHint', { amount: won(auction.next_minimum) })}
          </p>
        </form>
      )}
      {live && isSeller && <p className="mt-4 text-sm text-gray-600">{t('auction.sellerHint')}</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-800">{t('auction.history')}</h3>
      {bids.length === 0 ? (
        <p className="text-sm text-gray-500">{t('auction.noBids')}</p>
      ) : (
        <ol className="divide-y divide-orange-100 rounded-lg bg-white text-sm">
          {bids.map(bid => (
            <li
              key={bid.id}
              className={`flex items-center gap-2 px-3 py-2 sm:gap-3 ${bid.voided ? 'text-gray-400 line-through' : ''}`}
            >
              <span className="min-w-0 truncate font-medium">{bid.bidder_name}</span>
              {bid.is_mine && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                  {t('auction.mine')}
                </span>
              )}
              <span className="ml-auto shrink-0 whitespace-nowrap font-semibold">
                {won(bid.amount)}
              </span>
              <span className="shrink-0 whitespace-nowrap text-right text-xs text-gray-500 sm:w-28">
                {new Date(bid.created_at).toLocaleString(dateLocale, {
                  ...SEOUL_TIME_ZONE,
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {isAdmin && live && !bid.voided && (
                <button
                  type="button"
                  onClick={() => void voidBid(bid.id)}
                  disabled={busy}
                  className="text-xs text-red-600 no-underline hover:underline"
                >
                  {t('auction.void')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
