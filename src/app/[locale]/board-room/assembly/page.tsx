'use client'

import { useState, useEffect, useCallback } from 'react'
import { ASSEMBLY_DOCUMENT_CATEGORY } from '@/constants/boardRoom'
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

export default function AssemblyPage() {
  const [documents, setDocuments] = useState<BoardDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isAdmin, setIsAdmin] = useState(false)

  // 현재 사용자 id + 관리자 여부
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { supabase } = await import('@/lib/supabase/client')
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!mounted) return
        if (session?.user) {
          setCurrentUserId(session.user.id)
          const { data } = await supabase
            .from('member_profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .single()
          if (mounted) setIsAdmin(!!data?.is_admin)
        }
      } catch {
        // 무시 — 권한 없으면 삭제/관리 버튼 비노출
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
      <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">정기총회</h1>
      <p className="mb-8 text-sm text-gray-500">
        정기총회 자료집·회의록·감사보고서·거래내역서 등 총회 관련 자료를 보관합니다.
      </p>

      {/* 업로드 (카테고리 '총회' 고정) */}
      <div className="mb-8">
        <DocumentUpload onUploaded={fetchDocuments} fixedCategory={ASSEMBLY_DOCUMENT_CATEGORY} />
      </div>

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
