'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import RichTextEditor from '@/components/RichTextEditorDynamic'

interface EditablePost {
  id: string
  title: string
  content: string
  content_format?: string
  category: string
  author_id: string
}

interface EditPageClientProps {
  initialPost: EditablePost
}

export default function EditPageClient({ initialPost }: EditPageClientProps) {
  const router = useRouter()
  const [post, setPost] = useState<EditablePost>(initialPost)
  const [useRichEditor, setUseRichEditor] = useState(initialPost.content_format === 'html')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)

    const response = await fetch(`/api/posts/${post.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: post.title,
        content: post.content,
        content_format: useRichEditor ? 'html' : 'plain',
        category: post.category,
      }),
    })
    const result = (await response.json().catch(() => null)) as {
      success?: boolean
      error?: string
    } | null

    setSubmitting(false)

    if (!response.ok || !result?.success) {
      alert(result?.error || '게시글 수정 중 오류가 발생했습니다.')
    } else {
      alert('게시글이 수정되었습니다.')
      router.push(`/board/${post.id}`)
      router.refresh()
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setPost(prev => ({ ...prev, [name]: value }))
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push(`/board/${post.id}`)}
              className="text-gray-600 hover:text-gray-800 transition-colors flex items-center"
            >
              ← 게시글로 돌아가기
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <form onSubmit={handleSubmit}>
              <div className="p-6 border-b border-gray-200">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">게시글 수정</h1>

                <div className="mb-4">
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                    제목
                  </label>
                  <input
                    type="text"
                    id="title"
                    name="title"
                    value={post.title}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div className="mb-4">
                  <label
                    htmlFor="category"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    카테고리
                  </label>
                  <select
                    id="category"
                    name="category"
                    value={post.category}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="공지">공지</option>
                    <option value="잡담">잡담</option>
                    <option value="홍보">홍보</option>
                    <option value="건의">건의</option>
                  </select>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">내용</label>
                    <div className="flex items-center space-x-2">
                      <label className="flex items-center text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={useRichEditor}
                          onChange={e => setUseRichEditor(e.target.checked)}
                          className="mr-2 rounded"
                        />
                        리치 에디터 사용 (이미지 삽입 가능)
                      </label>
                    </div>
                  </div>

                  {useRichEditor ? (
                    <RichTextEditor
                      value={post.content}
                      onChange={content => setPost(prev => ({ ...prev, content }))}
                      placeholder="게시글 내용을 입력하세요..."
                      height={400}
                    />
                  ) : (
                    <textarea
                      id="content"
                      name="content"
                      value={post.content}
                      onChange={handleChange}
                      rows={10}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  )}
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => router.push(`/board/${post.id}`)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? '저장 중...' : '수정 완료'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
