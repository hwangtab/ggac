'use client'

import { useState, useEffect } from 'react'
import { PostContentRenderer } from '@/components/PostContentRenderer'
import { CHARTER_DOCUMENT_CATEGORY } from '@/constants/boardRoom'

interface CharterDocument {
  id: string
  title: string
  body_markdown: string | null
  created_at: string
}

/**
 * 정관 화면.
 *
 * 다른 서류와 달리 **사이드 메뉴에서 바로 들어오는 전용 화면**이다. 조합원이
 * 자기 권리·의무를 확인하는 기본 문서라 서류함 목록을 거치게 하지 않는다.
 *
 * 문서 id를 URL로 받지 않고 카테고리로 찾는 이유: 정관은 조합에 하나뿐이고,
 * 사이드 메뉴는 id를 모른다. 목록에서 id를 얻고 상세로 본문을 받는 2단계다 —
 * 목록 응답은 `has_body`만 주고 본문은 싣지 않는다(용량 때문이다).
 *
 * 등급 판정은 서버가 한다. 정관이 `visibility='board'`로 바뀌면 조합원에게는
 * 목록이 비어 오고, 이 화면은 "열람 권한이 없다"가 아니라 "아직 등록되지
 * 않았다"로 보인다 — 없는 것과 못 보는 것을 화면이 구분하지 않는 건 의도다.
 * 있다는 사실 자체를 알리지 않는 서버 정책(404)과 같은 방향이다.
 */
export default function CharterPage() {
  const [doc, setDoc] = useState<CharterDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const listRes = await fetch(
          `/api/board-room/documents?category=${encodeURIComponent(CHARTER_DOCUMENT_CATEGORY)}`
        )
        const listJson = await listRes.json()
        if (!mounted) return
        if (!listJson.success) {
          setError(listJson.error || '정관을 불러오지 못했습니다.')
          return
        }

        const documents = (listJson.data?.documents ?? []) as Array<{ id: string }>
        if (documents.length === 0) {
          setDoc(null)
          setError(null)
          return
        }

        const detailRes = await fetch(
          `/api/board-room/documents/${encodeURIComponent(documents[0].id)}`
        )
        const detailJson = await detailRes.json()
        if (!mounted) return
        if (detailJson.success) {
          setDoc(detailJson.data.document)
          setError(null)
        } else {
          setError(detailJson.error || '정관을 불러오지 못했습니다.')
        }
      } catch {
        if (mounted) setError('정관을 불러오지 못했습니다.')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl pb-16">
      {loading ? (
        <div className="space-y-3">
          <div className="h-9 w-48 animate-pulse rounded bg-gray-100" />
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
              <a
                href={`/api/board-room/documents/${encodeURIComponent(doc.id)}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
              >
                원본 PDF 내려받기
              </a>
            </div>
          </header>

          {doc.body_markdown ? (
            <>
              <PostContentRenderer
                content={doc.body_markdown}
                contentFormat="markdown"
                className="prose max-w-none"
              />
              <p className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-400">
                이 화면의 본문은 읽기 편하도록 옮겨 적은 것입니다. 조합의 정본은 위에서 내려받는
                원본 PDF입니다.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              정관 본문이 아직 등록되지 않았습니다. 위에서 원본 PDF를 내려받아 보십시오.
            </p>
          )}
        </article>
      ) : (
        <p className="text-sm text-gray-500">정관이 아직 등록되지 않았습니다.</p>
      )}
    </div>
  )
}
