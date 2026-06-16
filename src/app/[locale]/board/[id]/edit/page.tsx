import { notFound } from 'next/navigation'
import { Link, redirect } from '@/i18n/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { MemberProfile, Post as PostType } from '@/types'
import type { Locale } from '@/i18n/routing'
import EditPageClient from './EditPageClient'
import { validateUUID } from '@/utils/validation'

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
  const supabase = await createSupabaseServer()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect({
      href: {
        pathname: '/login',
        query: { redirect: `/board/${postId}/edit` },
      },
      locale,
    })
  }

  const { data: profile } = await supabase
    .from('member_profiles')
    .select('registration_status, is_active')
    .eq('id', user.id)
    .single()

  const typedProfile = profile as Pick<MemberProfile, 'registration_status' | 'is_active'> | null
  const isMember =
    typedProfile?.registration_status === 'approved' && typedProfile?.is_active === true

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

  const { data: postData, error: postError } = await supabase
    .from('posts')
    .select('id, title, content, content_format, category, author_id')
    .eq('id', postId)
    .single()

  if (postError || !postData) {
    notFound()
  }

  const post = postData as unknown as Pick<
    PostType,
    'id' | 'title' | 'content' | 'content_format' | 'category' | 'author_id'
  >

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
