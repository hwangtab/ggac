'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useImageUpload } from '@/hooks/useImageUpload'
import {
  MARKET_CONDITIONS,
  MARKET_DEAL_TYPES,
  MARKET_DESCRIPTION_MAX,
  MARKET_IMAGES_MAX,
  MARKET_ITEM_CATEGORIES,
  MARKET_REGION_MAX,
  MARKET_TITLE_MAX,
  MARKET_TRADE_METHODS,
  type MarketCondition,
  type MarketDealType,
  type MarketItemCategory,
  type MarketTradeMethod,
} from '@/constants/market'

export interface MarketFormInitial {
  id: string
  title: string
  description: string
  deal_type: MarketDealType
  item_category: MarketItemCategory
  price: number | null
  condition: MarketCondition | null
  trade_method: MarketTradeMethod | null
  region: string | null
  images: string[]
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

export default function MarketForm({ initial }: { initial?: MarketFormInitial }) {
  const t = useTranslations('market')
  const router = useRouter()
  const { uploadImage, uploadStatus } = useImageUpload()

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [dealType, setDealType] = useState<MarketDealType>(initial?.deal_type ?? 'sell')
  const [itemCategory, setItemCategory] = useState<MarketItemCategory>(
    initial?.item_category ?? 'instrument'
  )
  const [price, setPrice] = useState(
    initial?.price !== null && initial?.price !== undefined ? String(initial.price) : ''
  )
  const [condition, setCondition] = useState<string>(initial?.condition ?? '')
  const [tradeMethod, setTradeMethod] = useState<string>(initial?.trade_method ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    setError(null)
    for (const file of Array.from(files)) {
      if (images.length >= MARKET_IMAGES_MAX) break
      try {
        const url = await uploadImage(file)
        if (url) setImages(prev => (prev.length < MARKET_IMAGES_MAX ? [...prev, url] : prev))
      } catch (e) {
        setError(e instanceof Error ? e.message : t('form.error'))
      }
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(initial ? `/api/market/${initial.id}` : '/api/market', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          deal_type: dealType,
          item_category: itemCategory,
          price: dealType === 'free' ? 0 : price,
          condition: condition || null,
          trade_method: tradeMethod || null,
          region,
          images,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        setError(json?.error || t('form.error'))
        return
      }
      const id = json?.data?.id ?? initial?.id
      router.push(`/board/market/${id}`)
      router.refresh()
    } catch {
      setError(t('form.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg bg-white p-6 shadow-sm">
      <div>
        <span className="mb-2 block text-sm font-medium text-gray-700">{t('form.dealType')}</span>
        <div className="flex gap-2">
          {MARKET_DEAL_TYPES.map(deal => (
            <button
              key={deal}
              type="button"
              onClick={() => setDealType(deal)}
              aria-pressed={dealType === deal}
              className={`rounded-lg border px-4 py-2 text-sm ${
                dealType === deal
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700'
              }`}
            >
              {t(`deal.${deal}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.title')}</span>
        <input
          className={inputClass}
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={MARKET_TITLE_MAX}
          placeholder={t('form.titlePlaceholder')}
          required
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('form.itemCategory')}
          </span>
          <select
            className={inputClass}
            value={itemCategory}
            onChange={e => setItemCategory(e.target.value as MarketItemCategory)}
          >
            {MARKET_ITEM_CATEGORIES.map(item => (
              <option key={item} value={item}>
                {t(`item.${item}`)}
              </option>
            ))}
          </select>
        </label>

        {dealType !== 'free' && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.price')}</span>
            <input
              className={inputClass}
              inputMode="numeric"
              value={price}
              onChange={e => setPrice(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={t('form.pricePlaceholder')}
              required={dealType === 'sell'}
            />
            {dealType === 'buy' && (
              <span className="mt-1 block text-xs text-gray-500">{t('form.priceBuyHelp')}</span>
            )}
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('form.condition')}
          </span>
          <select
            className={inputClass}
            value={condition}
            onChange={e => setCondition(e.target.value)}
          >
            <option value="">{t('form.select')}</option>
            {MARKET_CONDITIONS.map(value => (
              <option key={value} value={value}>
                {t(`condition.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('form.tradeMethod')}
          </span>
          <select
            className={inputClass}
            value={tradeMethod}
            onChange={e => setTradeMethod(e.target.value)}
          >
            <option value="">{t('form.select')}</option>
            {MARKET_TRADE_METHODS.map(value => (
              <option key={value} value={value}>
                {t(`trade.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.region')}</span>
          <input
            className={inputClass}
            value={region}
            onChange={e => setRegion(e.target.value)}
            maxLength={MARKET_REGION_MAX}
            placeholder={t('form.regionPlaceholder')}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          {t('form.description')}
        </span>
        <textarea
          className={`${inputClass} min-h-40`}
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={MARKET_DESCRIPTION_MAX}
          placeholder={t('form.descriptionPlaceholder')}
          required
        />
        <span className="mt-1 block text-xs text-amber-700">{t('form.contactWarning')}</span>
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.images')}</span>
        <p className="mb-2 text-xs text-gray-500">
          {t('form.imagesHelp', { max: MARKET_IMAGES_MAX })}
        </p>
        <div className="flex flex-wrap gap-3">
          {images.map(url => (
            <div key={url} className="relative h-24 w-24 overflow-hidden rounded-lg bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages(prev => prev.filter(item => item !== url))}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
                aria-label={t('form.removeImage')}
              >
                ×
              </button>
            </div>
          ))}
          {images.length < MARKET_IMAGES_MAX && (
            <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-center text-xs text-gray-500 hover:border-primary-400">
              {uploadStatus.isUploading ? t('form.uploading') : t('form.addImage')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="sr-only"
                disabled={uploadStatus.isUploading}
                onChange={e => {
                  void handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700"
        >
          {t('form.cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting || uploadStatus.isUploading}
          className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {submitting ? t('form.submitting') : initial ? t('form.save') : t('form.submit')}
        </button>
      </div>
    </form>
  )
}
