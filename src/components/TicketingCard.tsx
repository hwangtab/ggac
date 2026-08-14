'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import Image from 'next/image'
import { createImageProxy } from '@/utils/imageValidation'
import { getSafeHostname, toSafeHttpUrl } from '@/utils/safeUrl'
import { useTranslations, useLocale } from 'next-intl'
import type { TicketingInfo, LinkPreview, TicketingCardProps } from '@/types'

const TicketingCard = ({ ticketing }: TicketingCardProps) => {
  const t = useTranslations('projects')
  const locale = useLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'
  const safeTicketingUrl = toSafeHttpUrl(ticketing.url)
  const hostname = getSafeHostname(ticketing.url)
  const [preview, setPreview] = useState<LinkPreview | null>(ticketing.preview || null)
  const [isLoading, setIsLoading] = useState(!ticketing.preview && !!safeTicketingUrl)
  const [hasError, setHasError] = useState(false)

  const fetchPreview = useCallback(async () => {
    if (!safeTicketingUrl) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const response = await fetch(`/api/link-preview?url=${encodeURIComponent(safeTicketingUrl)}`)

      if (response.ok) {
        // 표준 응답 래퍼: { success, data: LinkPreview }
        const json = await response.json()
        setPreview(json.data)
      } else {
        console.error('Failed to fetch preview:', response.status)
        setHasError(true)
      }
    } catch (error) {
      console.error('Error fetching preview:', error)
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }, [safeTicketingUrl])

  useEffect(() => {
    if (!ticketing.preview && ticketing.url) {
      // 클라이언트에서 프리뷰 데이터 가져오기
      fetchPreview()
    }
  }, [ticketing.url, ticketing.preview, fetchPreview])

  const getStatusColor = () => {
    if (!ticketing.available) return 'bg-red-100 text-red-800'
    return 'bg-green-100 text-green-800'
  }

  const getStatusText = () => {
    if (!ticketing.available) {
      if (ticketing.soldOutDate) {
        return t('ticketing.soldOutDate', {
          date: new Date(ticketing.soldOutDate).toLocaleDateString(dateLocale),
        })
      }
      return t('ticketing.soldOut')
    }

    if (ticketing.startDate && ticketing.endDate) {
      const now = new Date()
      const start = new Date(ticketing.startDate)
      const end = new Date(ticketing.endDate)

      if (now < start) {
        return t('ticketing.opensOn', { date: start.toLocaleDateString(dateLocale) })
      } else if (now > end) {
        return t('ticketing.closed')
      }
    }

    return t('ticketing.available')
  }

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="aspect-video bg-gray-100 animate-pulse"></div>
        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse flex-1 mr-2"></div>
            <div className="w-16 h-6 bg-gray-200 rounded-full animate-pulse"></div>
          </div>
          <div className="h-3 bg-gray-200 rounded animate-pulse mb-1"></div>
          <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4"></div>
        </div>
      </div>
    )
  }

  if (hasError || !preview) {
    const content = (
      <>
        <div className="aspect-video bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-white/55">TICKET</p>
            <div className="text-primary-600 font-medium">{ticketing.platform}</div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-gray-900 truncate flex-1 mr-2">
              {ticketing.platform}
            </h3>
            <span
              className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${getStatusColor()}`}
            >
              {getStatusText()}
            </span>
          </div>
          <p className="text-gray-600 text-sm">{t('ticketing.goToBooking')}</p>
          <div className="mt-2 text-xs text-gray-500 truncate">
            {hostname || ticketing.platform}
          </div>
        </div>
      </>
    )

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
        {safeTicketingUrl ? (
          <a href={safeTicketingUrl} target="_blank" rel="noopener noreferrer" className="block">
            {content}
          </a>
        ) : (
          <div className="block">{content}</div>
        )}
      </div>
    )
  }

  if (!safeTicketingUrl) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
        <div className="aspect-video bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-white/55">TICKET</p>
            <div className="text-primary-600 font-medium">{ticketing.platform}</div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-gray-900 truncate flex-1 mr-2">
              {ticketing.platform}
            </h3>
            <span
              className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${getStatusColor()}`}
            >
              {getStatusText()}
            </span>
          </div>
          <p className="text-gray-600 text-sm">{t('ticketing.goToBooking')}</p>
          <div className="mt-2 text-xs text-gray-500 truncate">{ticketing.platform}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
      <a href={safeTicketingUrl} target="_blank" rel="noopener noreferrer" className="block">
        {preview.image ? (
          <div className="aspect-video bg-gray-100 relative">
            <Image
              src={createImageProxy(preview.image)}
              alt={t('ticketing.previewAlt', { platform: preview.title || ticketing.platform })}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              onError={e => {
                // 이미지 로드 실패 시 fallback - XSS 방지를 위한 안전한 DOM 조작
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  // innerHTML 대신 안전한 DOM 조작 사용
                  while (parent.firstChild) {
                    parent.removeChild(parent.firstChild)
                  }

                  const fallbackDiv = document.createElement('div')
                  fallbackDiv.className =
                    'w-full h-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center'

                  const centerDiv = document.createElement('div')
                  centerDiv.className = 'text-center'

                  const iconDiv = document.createElement('div')
                  iconDiv.className = 'text-2xl mb-2'
                  iconDiv.textContent = 'TICKET'

                  const textDiv = document.createElement('div')
                  textDiv.className = 'text-primary-600 font-medium'
                  textDiv.textContent = ticketing.platform || t('ticketing.fallbackPlatform')

                  centerDiv.appendChild(iconDiv)
                  centerDiv.appendChild(textDiv)
                  fallbackDiv.appendChild(centerDiv)
                  parent.appendChild(fallbackDiv)
                }
              }}
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
            <div className="text-center">
              <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-white/55">TICKET</p>
              <div className="text-primary-600 font-medium">
                {preview.siteName || ticketing.platform}
              </div>
            </div>
          </div>
        )}

        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-gray-900 line-clamp-2 flex-1 mr-2">
              {preview.title || ticketing.platform}
            </h3>
            <span
              className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${getStatusColor()}`}
            >
              {getStatusText()}
            </span>
          </div>

          {preview.description && (
            <p className="text-gray-600 text-sm line-clamp-2 mb-2">{preview.description}</p>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center">
              {preview.favicon && (
                <div className="relative w-4 h-4 mr-1">
                  <Image
                    src={createImageProxy(preview.favicon)}
                    alt=""
                    aria-hidden="true"
                    width={16}
                    height={16}
                    className="object-contain"
                    onError={() => {
                      // favicon 로드 실패 시 숨김
                    }}
                  />
                </div>
              )}
              <span className="truncate">{preview.siteName || hostname || ticketing.platform}</span>
            </div>
          </div>
        </div>
      </a>
    </div>
  )
}

export default memo(TicketingCard)
