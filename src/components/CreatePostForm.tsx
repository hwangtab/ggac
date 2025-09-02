import React, { useState } from 'react'
import type { Post } from '@/types'
import { usePostCreation } from '@/hooks/usePostCreation'
import { useFileUpload } from '@/hooks/useFileUpload'
import { PostFormFields } from './forms/PostFormFields'
import { FileUploadArea } from './forms/FileUploadArea'

interface CreatePostFormProps {
  authorId: string
  onNewPost: (post: Post) => void
  showSuccessRedirect?: boolean
}

const CreatePostForm: React.FC<CreatePostFormProps> = ({ 
  authorId, 
  onNewPost, 
  showSuccessRedirect = false 
}) => {
  // 폼 상태
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('잡담')

  // 커스텀 훅들
  const { loading, createPost } = usePostCreation({
    authorId,
    onNewPost,
    showSuccessRedirect
  })

  const {
    selectedFiles,
    isDragOver,
    handleFileSelect,
    removeFile,
    clearFiles,
    uploadAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getFileIcon,
    formatFileSize,
    maxFiles
  } = useFileUpload()

  // 폼 제출 처리
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim()) {
      alert('제목을 입력해주세요.')
      return
    }

    if (!content.trim()) {
      alert('내용을 입력해주세요.')
      return
    }

    try {
      const uploadFn = selectedFiles.length > 0 ? uploadAttachments : undefined
      await createPost({ title, content, category }, uploadFn)
      
      // 폼 초기화
      setTitle('')
      setContent('')
      setCategory('잡담')
      clearFiles()
      
    } catch (error) {
      // 에러는 usePostCreation 훅에서 처리됨
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            새 게시글 작성
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 기본 폼 필드들 */}
            <PostFormFields
              title={title}
              content={content}
              category={category}
              onTitleChange={setTitle}
              onContentChange={setContent}
              onCategoryChange={setCategory}
            />

            {/* 파일 업로드 영역 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                첨부파일 (선택사항)
              </label>
              <FileUploadArea
                selectedFiles={selectedFiles}
                isDragOver={isDragOver}
                maxFiles={maxFiles}
                onFileSelect={handleFileSelect}
                onRemoveFile={removeFile}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                getFileIcon={getFileIcon}
                formatFileSize={formatFileSize}
              />
            </div>

            {/* 제출 버튼 */}
            <div className="flex justify-end pt-6 border-t border-gray-200">
              <button
                type="submit"
                disabled={loading || !title.trim() || !content.trim()}
                className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    작성 중...
                  </>
                ) : (
                  '게시글 작성'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default CreatePostForm