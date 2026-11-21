'use client'

import { useEffect, useState } from 'react'
import { PostContentRenderer } from '@/components/PostContentRenderer'
import { CHARTER_DOCUMENT_CATEGORY } from '@/constants/boardRoom'

interface CharterDocument {
  id: string
  title: string
  body_markdown: string | null
  created_at: string
}

interface CharterVersion {
  id: string
  title: string
  created_at: string
}

/**
 * 정관 화면.
 *
 * 다른 서류와 달리 **사이드 메뉴에서 바로 들어오는 전용 화면**이다. 조합원이
 * 자기 권리·의무를 확인하는 기본 문서라 서류함 목록을 거치게 하지 않는다.
 *
 * 같은 분류('정관')에 문서가 여럿이면 **가장 최근 것을 현행**으로 본문에 그리고
 * 나머지는 아래 '이전 정관' 목록으로 둔다(정관은 개정될 때마다 한 건씩 쌓이고,
 * 목록은 최신순이다). 항목을 고르면 라우트 이동 없이 본문만 바뀐다.
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
  const [versions, setVersions] = useState<CharterVersion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doc, setDoc] = useState<CharterDocument | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 목록(최신순)을 받아 첫 문서를 현행으로 삼는다.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(
          `/api/board-room/documents?category=${encodeURIComponent(CHARTER_DOCUMENT_CATEGORY)}`
        )
        const json = await res.json()
        if (!mounted) return
        if (!json.success) {
          setError(json.error || '정관을 불러오지 못했습니다.')
          return
        }
        const list = (json.data?.documents ?? []) as CharterVersion[]
        setVersions(list)
        setSelectedId(list[0]?.id ?? null)
        setError(null)
      } catch {
        if (mounted) setError('정관을 불러오지 못했습니다.')
      } finally {
        if (mounted) setListLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // 고른 판본의 본문을 받는다. 현행이 바뀌어도 같은 길로 다시 읽는다.
  useEffect(() => {
    if (!selectedId) {
      setDoc(null)
      return
    }
    let mounted = true
    setDocLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/board-room/documents/${encodeURIComponent(selectedId)}`)
        const json = await res.json()
        if (!mounted) return
        if (json.success) {
          setDoc(json.data.document)
          setError(null)
        } else {
          setError(json.error || '정관을 불러오지 못했습니다.')
        }
      } catch {
        if (mounted) setError('정관을 불러오지 못했습니다.')
      } finally {
        if (mounted) setDocLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [selectedId])

  const currentId = versions[0]?.id ?? null
  const isCurrent = selectedId != null && selectedId === currentId
  const olderVersions = versions.slice(1)

  const showSkeleton = listLoading || (docLoading && !doc)

  return (
    <div className="mx-auto max-w-3xl pb-16">
      {showSkeleton ? (
        <div className="space-y-3">
          <div className="h-9 w-48 animate-pulse rounded bg-gray-100" />
          <div className="h-64 animate-pulse rounded bg-gray-100" />
        </div>
      ) : error && versions.length === 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-gray-500">정관이 아직 등록되지 않았습니다.</p>
      ) : doc ? (
        <>
          <article>
            <header className="mb-8 border-b border-gray-200 pb-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isCurrent ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {isCurrent ? '현행' : '개정 이력'}
                </span>
                <span className="text-xs text-gray-400">{doc.created_at.slice(0, 10)}</span>
              </div>
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

          {olderVersions.length > 0 && (
            <section aria-labelledby="charter-history" className="mt-12">
              <h2 id="charter-history" className="mb-3 text-sm font-semibold text-gray-900">
                이전 정관
              </h2>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl ring-1 ring-gray-200">
                {olderVersions.map(version => (
                  <li key={version.id} className="flex items-center gap-3 bg-white px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedId(version.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {version.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-400">
                        {version.created_at.slice(0, 10)}
                      </span>
                    </button>
                    <a
                      href={`/api/board-room/documents/${encodeURIComponent(version.id)}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    >
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
