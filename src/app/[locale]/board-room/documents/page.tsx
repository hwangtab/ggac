'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BOARD_DOCUMENT_CATEGORIES } from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'
import DocumentList from '../_components/DocumentList'
import DocumentUpload from '../_components/DocumentUpload'

interface BoardDocument {
  id: string
  title: string
  category: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  created_at: string
  download_url: string | null
}

export default function DocumentsPage() {
  const t = useTranslations('boardRoom.documents')

  const [documents, setDocuments] = useState<BoardDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('') // '' = 전체
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await fetchSessionProfile()
        if (mounted) {
          setCurrentUserId(session.user?.id ?? '')
          setIsAdmin(isApprovedActiveAdmin(session.profile))
        }
      } catch {
        if (mounted) {
          setCurrentUserId('')
          setIsAdmin(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const url = activeCategory
        ? `/api/board-room/documents?category=${encodeURIComponent(activeCategory)}`
        : '/api/board-room/documents'
      const res = await fetch(url)
      const json = await res.json()
      if (json.success) {
        setDocuments(json.data.documents || [])
        setError(null)
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      setError(t('error'))
    } finally {
      setLoading(false)
    }
  }, [activeCategory, t])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const tabBase =
    'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap'
  const tabActive = 'bg-primary-600 text-white border-primary-600'
  const tabInactive = 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'

  return (
    <div className="mx-auto max-w-4xl pb-16">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/board-room"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← {t('back')}
        </Link>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-8">{t('heading')}</h1>

      {/* Upload */}
      <div className="mb-8">
        <DocumentUpload onUploaded={fetchDocuments} />
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setActiveCategory('')}
          className={`${tabBase} ${activeCategory === '' ? tabActive : tabInactive}`}
        >
          {t('all')}
        </button>
        {BOARD_DOCUMENT_CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setActiveCategory(c)}
            className={`${tabBase} ${activeCategory === c ? tabActive : tabInactive}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* List / states */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      ) : (
        <DocumentList
          documents={documents}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onChanged={fetchDocuments}
        />
      )}
    </div>
  )
}
