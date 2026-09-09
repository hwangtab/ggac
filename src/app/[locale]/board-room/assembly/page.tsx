'use client'

import { useState, useEffect, useCallback } from 'react'
import { ASSEMBLY_DOCUMENT_CATEGORY, ASSEMBLY_DOC_TYPES } from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'
import AssemblyDocumentList from '../_components/AssemblyDocumentList'
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

export default function AssemblyPage() {
  const [documents, setDocuments] = useState<BoardDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

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
      const res = await fetch(
        `/api/board-room/documents?category=${encodeURIComponent(ASSEMBLY_DOCUMENT_CATEGORY)}`
      )
      const json = await res.json()
      if (json.success) {
        setDocuments(json.data.documents || [])
        setError(null)
      } else {
        setError(json.error || '총회 자료를 불러오지 못했습니다.')
      }
    } catch {
      setError('총회 자료를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">정기총회</h1>
          <p className="text-sm text-gray-500">
            연도별 총회 자료집·회의록·감사보고서·결산서를 한곳에 모아 둡니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowUpload(v => !v)}
          aria-expanded={showUpload}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            showUpload
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {showUpload ? '닫기' : '자료 올리기'}
        </button>
      </div>

      {showUpload && (
        <div className="mb-8">
          <DocumentUpload
            onUploaded={() => {
              setShowUpload(false)
              fetchDocuments()
            }}
            fixedCategory={ASSEMBLY_DOCUMENT_CATEGORY}
            titlePrefixes={ASSEMBLY_DOC_TYPES}
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <AssemblyDocumentList
          documents={documents}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onChanged={fetchDocuments}
        />
      )}
    </div>
  )
}
