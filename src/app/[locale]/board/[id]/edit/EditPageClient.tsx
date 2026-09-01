'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import RichTextEditor from '@/components/RichTextEditorDynamic'
import { BOARD_CATEGORIES } from '@/constants/categories'

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

// '전체'는 필터링용이라 작성 카테고리가 아니다 — PostFormFields.tsx와 같은 방식으로 제외한다.
const EDITABLE_CATEGORIES = BOARD_CATEGORIES.slice(1)

// 이 편집기가 다루는 content_format은 'html'·'plain' 두 가지뿐이다. 그 외
// (지원사업 회차 게시글의 'markdown' 등)는 편집기가 만들지도, 이해하지도
// 못하는 형식이라 — 저장할 때 원래 값을 그대로 되돌려 보낸다. 여기서 마크다운
// 편집 모드를 새로 만들지 않는다(범위 밖). undefined는 기존 동작대로 관리
// 대상('plain' 취급)으로 본다.
function isManagedContentFormat(format: string | undefined): boolean {
  return format === undefined || format === 'html' || format === 'plain'
}

export default function EditPageClient({ initialPost }: EditPageClientProps) {
  const router = useRouter()
  const [post, setPost] = useState<EditablePost>(initialPost)
  const [useRichEditor, setUseRichEditor] = useState(initialPost.content_format === 'html')
  const [submitting, setSubmitting] = useState(false)
  const formatManaged = isManagedContentFormat(initialPost.content_format)

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
        content_format: formatManaged
          ? useRichEditor
            ? 'html'
            : 'plain'
          : initialPost.content_format,
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
                    {EDITABLE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">내용</label>
                    <div className="flex items-center space-x-2">
                      {formatManaged ? (
                        <label className="flex items-center text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={useRichEditor}
                            onChange={e => setUseRichEditor(e.target.checked)}
                            className="mr-2 rounded"
                          />
                          리치 에디터 사용 (이미지 삽입 가능)
                        </label>
                      ) : (
                        <span className="text-sm text-gray-500">
                          이 게시글은 원문 서식을 그대로 유지하며 수정됩니다.
                        </span>
                      )}
                    </div>
                  </div>

                  {formatManaged && useRichEditor ? (
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
