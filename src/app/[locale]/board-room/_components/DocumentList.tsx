'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { isSafeInternalPath } from '@/utils/safeUrl'
import { useDesktopEditorKnown } from '@work/components/files/office-edit/use-desktop-editor'
import { canOfferAppEdit } from '@work/lib/files/app-edit'

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

interface DocumentListProps {
  documents: BoardDocument[]
  currentUserId: string
  isAdmin: boolean
  /** 이사·감사·관리자인가 — 버전 기록·앱 편집 진입점은 이사회 안에서만 보인다(조합원은 API 도 403) */
  isBoardMember?: boolean
  onChanged: () => void
}

/** Format a byte count into a human-readable string (B / KB / MB). */
function formatFileSize(bytes: number | null): string {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

/** ISO → `YYYY-MM-DD`(한국 시간). 브라우저 시간대로 찍으면 해외에서 보거나 자정 무렵 올린 서류의 날짜가 하루 어긋난다 */
const SEOUL_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return SEOUL_DATE.format(d)
}

export default function DocumentList({
  documents,
  currentUserId,
  isAdmin,
  isBoardMember = false,
  onChanged,
}: DocumentListProps) {
  const t = useTranslations('boardRoom.documents')
  const desktop = useDesktopEditorKnown()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (deletingId) return
    if (!confirm(t('confirmDelete'))) return
    setDeletingId(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/board-room/documents/${id}`, {
        method: 'DELETE',
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
      } | null
      if (!res.ok || !json?.success) {
        // 실패를 삼키면 눌러도 아무 일이 없는 것처럼 보인다 — 자료실(BoardDocumentsPanel)처럼 이유를 보여 준다
        setDeleteError(json?.error || '서류를 지우지 못했습니다.')
        return
      }
      onChanged()
    } catch {
      setDeleteError('네트워크 문제로 서류를 지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setDeletingId(null)
    }
  }

  if (documents.length === 0) {
    return <p className="text-sm text-gray-500 italic py-6 text-center">{t('empty')}</p>
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <p
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          {deleteError}
        </p>
      )}
      {documents.map(doc => {
        const canDelete = doc.uploaded_by === currentUserId || isAdmin
        // download_url은 이제 우리 API의 내부 경로다(`/api/board-room/...`).
        // toSafeHttpUrl은 절대 URL만 받으므로 내부 경로 검사기를 쓴다.
        const safeDownloadUrl =
          doc.download_url && isSafeInternalPath(doc.download_url) ? doc.download_url : null
        return (
          <div
            key={doc.id}
            className="p-4 bg-white border border-gray-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-indigo-50 text-indigo-700 border-indigo-200 shrink-0">
                  {doc.category}
                </span>
                <h3 className="text-sm font-semibold text-gray-900 break-all">{doc.title}</h3>
              </div>
              <p className="text-xs text-gray-500 mt-1 break-all">
                {doc.file_name}
                <span className="text-gray-400"> · {formatFileSize(doc.file_size)}</span>
                <span className="text-gray-400"> · {formatDate(doc.created_at)}</span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {safeDownloadUrl ? (
                <a
                  href={safeDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 transition-colors whitespace-nowrap"
                >
                  {t('download')}
                </a>
              ) : (
                <span className="px-3 py-1.5 bg-gray-100 text-gray-400 text-xs font-medium rounded-lg whitespace-nowrap">
                  {t('download')}
                </span>
              )}
              {/* 앱 편집(docs/board-work/05-이사회-서류-앱-편집.md §7) — 지울 수 있는 사람(올린 사람·관리자)과 같은 사람,
                  PC, 이 배포의 편집기가 여는 형식만. 실제 차단은 편집 API 가 한다. */}
              {isBoardMember &&
                canDelete &&
                desktop === true &&
                canOfferAppEdit(doc.file_name || doc.title, doc.file_size ?? 0) && (
                  <Link
                    href={`/board-room/documents/${doc.id}/edit`}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                  >
                    {t('editInApp')}
                  </Link>
                )}
              {isBoardMember && (
                <Link
                  href={`/board-room/documents/${doc.id}`}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  {t('versions')}
                </Link>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {t('delete')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
