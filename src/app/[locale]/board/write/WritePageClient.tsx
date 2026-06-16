'use client'

import { useRouter } from '@/i18n/navigation'
import nextDynamic from 'next/dynamic'

const CreatePostForm = nextDynamic(() => import('@/components/CreatePostForm'), {
  loading: () => (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-10 bg-gray-200 rounded w-24"></div>
      </div>
    </div>
  ),
})

interface WritePageClientProps {
  userId: string
}

export default function WritePageClient({ userId }: WritePageClientProps) {
  const router = useRouter()

  const handlePostCreated = () => {
    router.push('/board')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24 pb-16 md:pb-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 md:mb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">게시글 작성</h1>
                <p className="text-gray-600 mt-2">
                  새로운 게시글을 작성하고 조합원들과 소통해보세요.
                </p>
              </div>
              <button
                onClick={() => router.push('/board')}
                className="inline-flex items-center text-gray-600 hover:text-gray-800 transition-colors text-sm sm:text-base"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                게시판으로 돌아가기
              </button>
            </div>
          </div>

          <CreatePostForm
            authorId={userId}
            onNewPost={handlePostCreated}
            showSuccessRedirect={true}
          />
        </div>
      </div>
    </div>
  )
}
