'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { PostContentRenderer } from '@/components/PostContentRenderer'

interface DocumentDetail {
  id: string
  title: string
  body_markdown: string | null
  file_name: string | null
  created_at: string
}

export default function AssemblyDocumentPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(`/api/board-room/documents/${encodeURIComponent(id)}`)
        const json = await res.json()
        if (!mounted) return
        if (json.success) {
          setDoc(json.data.document)
          setError(null)
        } else {
          setError(json.error || '자료를 불러오지 못했습니다.')
        }
      } catch {
        if (mounted) setError('자료를 불러오지 못했습니다.')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [id])

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <Link
        href="/board-room/assembly"
        className="mb-6 inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        ← 정기총회로
      </Link>

      {loading ? (
        <div className="space-y-3">
          <div className="h-8 w-2/3 animate-pulse rounded bg-gray-100" />
          <div className="h-64 animate-pulse rounded bg-gray-100" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : doc ? (
        <article>
          <header className="mb-8 border-b border-gray-200 pb-4">
            <h1 className="text-2xl font-bold text-gray-900 md:text-3xl">{doc.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <span>{doc.created_at.slice(0, 10)}</span>
              <a
                href={`/api/board-room/documents/${encodeURIComponent(doc.id)}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
              >
                PDF 내려받기
              </a>
            </div>
          </header>

          {doc.body_markdown ? (
            <PostContentRenderer
              content={doc.body_markdown}
              contentFormat="markdown"
              className="prose max-w-none"
            />
          ) : (
            <p className="text-sm text-gray-500">
              이 자료는 파일로만 있습니다. 위에서 내려받아 보십시오.
            </p>
          )}
        </article>
      ) : null}
    </div>
  )
}
