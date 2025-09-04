'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import Image from 'next/image'
import { createImageProxy } from '@/utils/imageValidation'
import type { LinkPreview, ArticleInfo, ArticleCardProps } from '@/types'

const ArticleCard = ({ article }: ArticleCardProps) => {
  const [preview, setPreview] = useState<LinkPreview | null>(article.preview || null)
  const [isLoading, setIsLoading] = useState(!article.preview)
  const [hasError, setHasError] = useState(false)

  const fetchPreview = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/link-preview?url=${encodeURIComponent(article.url)}`)

      if (response.ok) {
        const previewData = await response.json()
        setPreview(previewData)
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
  }, [article.url])

  useEffect(() => {
    if (!article.preview && article.url) {
      fetchPreview()
    }
  }, [article.url, article.preview, fetchPreview])

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="aspect-video bg-gray-100 animate-pulse"></div>
        <div className="p-4">
          <div className="h-4 bg-gray-200 rounded animate-pulse flex-1 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded animate-pulse mb-1"></div>
          <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4"></div>
        </div>
      </div>
    )
  }

  if (hasError || !preview) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="block">
          <div className="aspect-video bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2">📰</div>
              <div className="text-blue-600 font-medium">{article.title}</div>
            </div>
          </div>
          <div className="p-4">
            <h4 className="font-semibold text-gray-900 truncate flex-1 mr-2">{article.title}</h4>
            <p className="text-gray-600 text-sm">기사 링크로 이동</p>
            <div className="mt-2 text-xs text-gray-500 truncate">
              {new URL(article.url).hostname}
            </div>
          </div>
        </a>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="block">
        {preview.image ? (
          <div className="aspect-video bg-gray-100 relative">
            <Image
              src={createImageProxy(preview.image)}
              alt={preview.title || article.title || '기사 이미지'}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              onError={() => {
                // Next.js Image의 onError는 제한적이므로 fallback UI를 state로 관리
                setHasError(true)
              }}
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2">📰</div>
              <div className="text-blue-600 font-medium">{preview.siteName || article.title}</div>
            </div>
          </div>
        )}

        <div className="p-4">
          <h4 className="font-semibold text-gray-900 line-clamp-2 flex-1 mr-2">
            {preview.title || article.title}
          </h4>

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
                    width={16}
                    height={16}
                    className="object-contain"
                    onError={() => {
                      // favicon 로드 실패 시 숨김
                    }}
                  />
                </div>
              )}
              <span className="truncate">{preview.siteName || new URL(article.url).hostname}</span>
            </div>
          </div>
        </div>
      </a>
    </div>
  )
}

export default memo(ArticleCard)
