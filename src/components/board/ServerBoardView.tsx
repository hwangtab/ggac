import { Link } from '@/i18n/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import type { BoardInitialPost } from '@/lib/server/board'
import type { BoardCategory } from '@/constants/categories'

interface ServerBoardViewProps {
  posts: BoardInitialPost[]
  category: BoardCategory
  pagination: {
    hasNext: boolean
    hasPrev: boolean
    currentPage: number
  }
  renderAuthSection?: () => React.ReactNode
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

const ServerBoardView = async ({
  posts,
  category,
  pagination,
  renderAuthSection,
}: ServerBoardViewProps) => {
  const t = await getTranslations('board')
  const locale = await getLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-8">
          <h2 className="tw-heading-secondary mb-2">{t('heading')}</h2>
          <p className="text-gray-600">{t('subtitle')}</p>
        </div>

        {renderAuthSection?.()}

        <div className="space-y-4">
          {posts.map(post => (
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
            {t('pagination.summary', { page: pagination.currentPage, count: posts.length })}
          </span>

          {pagination.hasNext ? (
            <Link
              prefetch={false}
              href={buildBoardUrl(category, pagination.currentPage + 1)}
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

export default ServerBoardView
