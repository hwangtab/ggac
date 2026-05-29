'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

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

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function DocumentList({
  documents,
  currentUserId,
  isAdmin,
  onChanged,
}: DocumentListProps) {
  const t = useTranslations('boardRoom.documents')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/board-room/documents/${id}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        onChanged()
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setDeletingId(null)
    }
  }

  if (documents.length === 0) {
    return <p className="text-sm text-gray-500 italic py-6 text-center">{t('empty')}</p>
  }

  return (
    <div className="space-y-3">
      {documents.map(doc => {
        const canDelete = doc.uploaded_by === currentUserId || isAdmin
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
              {doc.download_url ? (
                <a
                  href={doc.download_url}
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
