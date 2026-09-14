'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BOARD_DOCUMENT_CATEGORIES } from '@/constants/boardRoom'
import {
  fetchSessionProfile,
  isApprovedActiveAdmin,
  canAccessBoardRoom,
} from '@/utils/sessionProfile'
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
  // 조합원에게 이 화면은 **읽는 곳**이다. 업로드·카테고리 탭을 감추고 평면
  // 목록으로 둔다 — 볼 수 있는 자료가 한 자리 수인 동안은 탭이 방해다.
  // 실제 차단은 서버가 한다(`visibilityScopeFor` + 업로드는 requireBoardMember).
  //
  // 세 값인 이유는 레이아웃과 같다: `null`은 아직 판정하지 못한 상태다.
  // false로 접으면 판정이 도달하지 않아도 조합원 화면이 그려져, 이사가 잠깐
  // '조합 서류'를 보고 업로드 컨트롤이 사라지는 깜빡임이 생긴다.
  const [isBoardMember, setIsBoardMember] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await fetchSessionProfile()
        if (mounted) {
          setCurrentUserId(session.user?.id ?? '')
          setIsAdmin(isApprovedActiveAdmin(session.profile))
          // 인증이 확인된 세션만 판정으로 받는다. 실패는 `null`로 남긴다.
          if (session.authenticated) setIsBoardMember(canAccessBoardRoom(session.profile))
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
      {/* Back link — 이사 전용. 조합원에게 /board-room은 이 화면으로 되돌아오는
          리다이렉트라, 돌아가기 링크를 두면 제자리를 맴돈다. */}
      {isBoardMember && (
        <div className="mb-6">
          <Link
            href="/board-room"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← {t('back')}
          </Link>
        </div>
      )}

      {isBoardMember === null ? (
        <div className="mb-8 h-9 w-48 animate-pulse rounded bg-gray-100" />
      ) : (
        <>
          <h1
            className={`text-2xl md:text-3xl font-bold text-gray-900 ${
              isBoardMember ? 'mb-8' : 'mb-2'
            }`}
          >
            {isBoardMember ? t('heading') : t('memberHeading')}
          </h1>
          {!isBoardMember && <p className="mb-8 text-sm text-gray-500">{t('memberDescription')}</p>}
        </>
      )}

      {/* Upload — 이사·감사·관리자만. 서버도 requireBoardMember다. */}
      {isBoardMember && (
        <div className="mb-8">
          <DocumentUpload onUploaded={fetchDocuments} />
        </div>
      )}

      {/* Category filter tabs — 이사 전용. 조합원은 평면 목록으로 본다. */}
      {isBoardMember && (
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
      )}

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
