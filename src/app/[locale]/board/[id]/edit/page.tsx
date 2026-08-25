import { notFound } from 'next/navigation'
import { Link, redirect } from '@/i18n/navigation'
import { readSessionUser } from '@/lib/server/session'
import type { Locale } from '@/i18n/routing'
import EditPageClient from './EditPageClient'
import { validateUUID } from '@/utils/validation'
import { getProfileById } from '@/db/queries/profiles'
import { getPostById } from '@/db/queries/posts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PageProps {
  params: Promise<{ locale: Locale; id: string }>
}

export default async function PostEditPage({ params }: PageProps) {
  const { locale, id } = await params
  const postIdValidation = validateUUID(id, '게시글 ID')
  if (!postIdValidation.isValid) {
    notFound()
  }
  const postId = postIdValidation.sanitized

  const user = await readSessionUser()

  if (!user) {
    redirect({
      href: {
        pathname: '/login',
        query: { redirect: `/board/${postId}/edit` },
      },
      locale,
    })
  }

  // 단계 2c(Task 5): member_profiles 조회를 Supabase
  // `.eq('id', user.id)`에서 Turso 쿼리 계층 getProfileById(user.id)로
  // 옮겼다 — 조건식(registration_status==='approved' && is_active)은
  // 문자 그대로 보존.
  const profile = await getProfileById(user.id).catch(() => null)
  const isMember = profile?.registration_status === 'approved' && profile?.is_active === true

  if (!isMember) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-yellow-800 mb-4">접근 권한이 없습니다</h1>
              <p className="text-yellow-700 mb-4">게시글 수정은 승인된 조합원만 가능합니다.</p>
              <Link
                href="/board"
                className="inline-block bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                게시판으로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 단계 2c(Task 5): posts 조회를 Supabase `.eq('id', postId)`(is_deleted
  // 필터 없음)에서 Turso 쿼리 계층 getPostById(postId, { includeDeleted:
  // true })로 옮겼다 — 삭제된 글에도 필터를 걸지 않던 기존 동작을 그대로
  // 재현한다(권한 판정은 아래 author_id 비교로 여전히 동일하게 막는다).
  const fullPost = await getPostById(postId, { includeDeleted: true }).catch(() => null)

  if (!fullPost) {
    notFound()
  }

  const post = {
    id: fullPost.id,
    title: fullPost.title,
    content: fullPost.content,
    content_format: fullPost.content_format,
    category: fullPost.category,
    author_id: fullPost.author_id,
  }

  if (post.author_id !== user.id) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-red-800 mb-4">오류</h1>
              <p className="text-red-700 mb-4">수정 권한이 없습니다.</p>
              <Link
                href="/board"
                className="inline-block bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                게시판으로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <EditPageClient
      initialPost={{
        id: post.id,
        title: post.title,
        content: post.content,
        content_format: post.content_format ?? undefined,
        category: post.category,
        author_id: post.author_id,
      }}
    />
  )
}
