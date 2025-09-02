'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { BOARD_CATEGORIES } from '@/constants/categories'

// TinyMCE를 동적으로 로드하여 SSR 이슈 방지
const RichTextEditor = dynamic(() => import('../RichTextEditor'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-100 rounded-lg animate-pulse" />
})

interface PostFormFieldsProps {
  title: string
  content: string
  category: string
  onTitleChange: (title: string) => void
  onContentChange: (content: string) => void
  onCategoryChange: (category: string) => void
}

export const PostFormFields: React.FC<PostFormFieldsProps> = ({
  title,
  content,
  category,
  onTitleChange,
  onContentChange,
  onCategoryChange
}) => {
  // '전체'는 필터링용이므로 제외하고 실제 게시글 카테고리만 사용
  const postCategories = BOARD_CATEGORIES.slice(1)

  return (
    <div className="space-y-6">
      {/* 제목 입력 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          제목 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="게시글 제목을 입력하세요"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        />
      </div>

      {/* 카테고리 선택 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          카테고리 <span className="text-red-500">*</span>
        </label>
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        >
          {postCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* 내용 입력 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          내용 <span className="text-red-500">*</span>
        </label>
        <div className="border border-gray-300 rounded-lg overflow-hidden">
          <RichTextEditor
            value={content}
            onChange={onContentChange}
            placeholder="게시글 내용을 입력하세요..."
          />
        </div>
      </div>
    </div>
  )
}