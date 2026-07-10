'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { parseBoardCategory } from '@/constants/categories'
import { parseIntegerParam } from '@/utils/queryParams'
import type { BoardInitialPost } from '@/lib/server/board'
import type { BoardCategory } from '@/constants/categories'

interface BoardListViewProps {
  posts: BoardInitialPost[]
  pageSize: number
  category: BoardCategory
  requestedPage: number
  authSection?: React.ReactNode
}

interface ServerBoardViewProps {
  posts: BoardInitialPost[]
  pageSize: number
  authSection?: React.ReactNode
}

const buildBoardUrl = (category: BoardCategory, page?: number) => {
  const params = new URLSearchParams()
  if (category && category !== '전체') {
    params.set('category', category)
  }
  if (page && page > 1) {
    params.set('page', page.toString())
  }
  const query = params.toString()
  return query ? `/board?${query}` : '/board'
}

// 카테고리(?category=)·페이지(?page=)를 클라이언트에서 파생한다.
// 서버가 searchParams를 읽으면 /board 전체가 동적 렌더링으로 전환되어
// ISR(revalidate=60)이 사문화되므로(전수감사 P3), 서버는 전체 게시글을
// ISR로 렌더하고 여기서 allowlist(parseBoardCategory) 검증 후 필터·슬라이스한다.
//
// 구조가 둘로 나뉜 이유: useSearchParams를 쓰는 컴포넌트는 정적 프리렌더에서
// 가장 가까운 Suspense 경계까지 CSR bailout되어 초기 HTML에서 목록이 통째로
// 빠진다(SEO·첫 페인트 손실). 그래서 파생만 하는 브리지(ServerBoardView)와
// searchParams를 모르는 프레젠테이션(BoardListView)을 분리하고, Suspense
// fallback에 기본 상태(전체·1페이지)의 BoardListView를 렌더해 프리렌더 HTML에
// 목록 콘텐츠를 포함시킨다.
export const BoardListView = ({
  posts,
  pageSize,
  category,
  requestedPage,
  authSection,
}: BoardListViewProps) => {
  const t = useTranslations('board')
  const locale = useLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'

  const filteredPosts = useMemo(
    () => (category === '전체' ? posts : posts.filter(post => post.category === category)),
    [posts, category]
  )

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize))
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const pagePosts = filteredPosts.slice(startIndex, startIndex + pageSize)
  const pagination = {
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
    currentPage,
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-8">
          <h2 className="tw-heading-secondary mb-2">{t('heading')}</h2>
          <p className="text-gray-600">{t('subtitle')}</p>
        </div>

        {authSection}

        <div className="space-y-4">
          {pagePosts.map(post => (
            <article
              key={post.id}
              className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                  {post.category}
                </span>
                <span className="text-sm text-gray-500">
                  {new Date(post.created_at).toLocaleDateString(dateLocale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <Link href={`/board/${post.id}`} className="block group">
                <h3 className="text-2xl font-post font-semibold text-gray-700 group-hover:text-primary-600 transition-colors">
                  {post.title}
                </h3>
                <p className="text-gray-600 mt-3 line-clamp-3">{post.content_preview}</p>
              </Link>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <span>
                    {t('commentsLabel')} {post.comment_count}
                  </span>
                  <span>
                    {t('likesLabel')} {post.like_count}
                  </span>
                  {post.attachments_stats.total_attachments > 0 && (
                    <span>
                      {t('attachmentsLabel')} {post.attachments_stats.total_attachments}
                    </span>
                  )}
                </div>
                <Link
                  href={`/board/${post.id}`}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  {t('readMoreLink')}
                </Link>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 flex justify-between items-center">
          {pagination.hasPrev ? (
            <Link
              prefetch={false}
              href={buildBoardUrl(category, pagination.currentPage - 1)}
              scroll={false}
              className="px-4 py-2 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700"
            >
              {t('pagination.prev')}
            </Link>
          ) : (
            <span className="px-4 py-2 rounded-lg font-medium bg-gray-300 text-gray-500">
              {t('pagination.prev')}
            </span>
          )}

          <span className="text-gray-600">
            {t('pagination.summary', { page: pagination.currentPage, count: pagePosts.length })}
          </span>

          {pagination.hasNext ? (
            <Link
              prefetch={false}
              href={buildBoardUrl(category, pagination.currentPage + 1)}
              scroll={false}
              className="px-4 py-2 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700"
            >
              {t('pagination.next')}
            </Link>
          ) : (
            <span className="px-4 py-2 rounded-lg font-medium bg-gray-300 text-gray-500">
              {t('pagination.next')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// searchParams 브리지 — URL 쿼리를 파생해 프레젠테이션 뷰에 넘긴다.
const ServerBoardView = ({ posts, pageSize, authSection }: ServerBoardViewProps) => {
  const searchParams = useSearchParams()
  const category = parseBoardCategory(searchParams.get('category') ?? undefined) ?? '전체'
  const requestedPage = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })

  return (
    <BoardListView
      posts={posts}
      pageSize={pageSize}
      category={category}
      requestedPage={requestedPage}
      authSection={authSection}
    />
  )
}

export default ServerBoardView
