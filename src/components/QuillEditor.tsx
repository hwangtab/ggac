'use client'

import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import 'react-quill-new/dist/quill.snow.css'
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation'
import { generateTempId } from '@/utils/security'
import toast from 'react-hot-toast'

const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill-new')
    const QuillWrapper = ({ forwardedRef, ...props }: any) => <RQ ref={forwardedRef} {...props} />
    QuillWrapper.displayName = 'QuillWrapper'
    return QuillWrapper
  },
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-gray-100 rounded-md" style={{ height: 400 }}>
        <div className="h-12 bg-gray-200 rounded-t-md mb-2"></div>
        <div className="px-3 py-2 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        </div>
      </div>
    ),
  }
)

interface QuillEditorProps {
  value: string
  onChange: (content: string) => void
  placeholder?: string
  disabled?: boolean
  height?: number
}

export const QuillEditor: React.FC<QuillEditorProps> = ({
  value,
  onChange,
  placeholder = '내용을 입력하세요...',
  disabled = false,
  height = 400,
}) => {
  const quillRef = useRef<any>(null)

  // 업로드 상태 관리
  const [uploadStatus, setUploadStatus] = useState<{
    isUploading: boolean
    fileName: string | null
  }>({
    isUploading: false,
    fileName: null,
  })

  // 컴포넌트 마운트 시 디버깅 로그
  useEffect(() => {
    console.log('[QuillEditor] 컴포넌트 초기화 완료')
  }, [])

  // 스크롤 상태 관리 및 키보드 단축키
  useEffect(() => {
    const editor = quillRef.current?.getEditor()
    const editorElement = editor?.container?.querySelector('.ql-editor')

    if (!editorElement) return

    // 스크롤 힌트 관리
    const checkScrollable = () => {
      const isScrollable = editorElement.scrollHeight > editorElement.clientHeight
      editorElement.classList.toggle('scrollable', isScrollable)
    }

    // 키보드 단축키 핸들러
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'Home':
            e.preventDefault()
            editor?.setSelection(0, 0)
            editorElement.scrollTop = 0
            break
          case 'End':
            e.preventDefault()
            const length = editor?.getLength() || 0
            editor?.setSelection(length - 1, 0)
            editorElement.scrollTop = editorElement.scrollHeight
            break
        }
      }
    }

    // 이벤트 리스너 등록
    const observer = new ResizeObserver(checkScrollable)
    observer.observe(editorElement)
    editorElement.addEventListener('input', checkScrollable)
    editorElement.addEventListener('keydown', handleKeyDown)

    // 초기 체크
    checkScrollable()

    return () => {
      observer.disconnect()
      editorElement.removeEventListener('input', checkScrollable)
      editorElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [quillRef.current])

  // 이미지 업로드 핸들러 (기존 TinyMCE 로직 재사용)
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    // 업로드 상태 시작
    setUploadStatus({
      isUploading: true,
      fileName: file.name,
    })

    // 로딩 토스트 시작
    const toastId = toast.loading(`${file.name} 업로드 중...`)

    try {
      console.log('[QuillEditor] 이미지 업로드 시작:', file.name)

      // 1. 파일 검증
      const validation = await validateFile(file)
      if (!validation.isValid) {
        throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`)
      }

      if (validation.fileType !== 'image') {
        throw new Error('이미지 파일만 업로드할 수 있습니다.')
      }

      console.log('[QuillEditor] 파일 검증 완료')

      // 2. 이미지 메타데이터 제거
      const sanitizedFile = await sanitizeImageFile(file)

      // 3. /api/media/upload API 사용 (MediaManager와 동일한 방식)
      const formData = new FormData()
      formData.append('file', sanitizedFile)
      formData.append('bucket', 'attachments')

      // 메타데이터 추가
      const metadata = {
        original_filename: file.name,
        file_size: file.size,
        content_type: file.type,
        uploaded_at: new Date().toISOString(),
      }
      formData.append('metadata', JSON.stringify(metadata))

      console.log('[QuillEditor] 서버 업로드 시작')

      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: '서버 응답을 파싱할 수 없습니다.' }))
        throw new Error(errorData.error || '이미지 업로드에 실패했습니다.')
      }

      const result = await response.json()
      console.log('[QuillEditor] 이미지 업로드 성공:', result.public_url)

      // 성공 처리
      toast.success(`${file.name} 업로드 완료!`, {
        id: toastId,
      })

      // 업로드 상태 리셋
      setUploadStatus({
        isUploading: false,
        fileName: null,
      })

      return result.public_url
    } catch (error) {
      console.error('[QuillEditor] 이미지 업로드 오류:', error)

      // 사용자 친화적인 에러 메시지
      let userMessage = '이미지 업로드에 실패했습니다.'
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('파일 크기')) {
        userMessage = '이미지 파일 크기가 너무 큽니다. 5MB 이하의 이미지를 선택해주세요.'
      } else if (errorMessage.includes('파일 형식') || errorMessage.includes('지원하지 않는')) {
        userMessage =
          '지원하지 않는 이미지 형식입니다. JPG, PNG, GIF, WebP 파일만 업로드 가능합니다.'
      } else if (errorMessage.includes('네트워크') || errorMessage.includes('서버')) {
        userMessage = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      } else if (errorMessage.includes('권한')) {
        userMessage = '파일 업로드 권한이 없습니다. 로그인 상태를 확인해주세요.'
      }

      // 오류 토스트 표시
      toast.error(userMessage, {
        id: toastId,
      })

      // 업로드 상태 리셋
      setUploadStatus({
        isUploading: false,
        fileName: null,
      })

      throw error
    }
  }, [])

  // Quill 모듈 설정
  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ align: [] }],
          ['link', 'image'],
          ['blockquote', 'code-block'],
          ['clean'],
        ],
        handlers: {
          image: function () {
            const input = document.createElement('input')
            input.setAttribute('type', 'file')
            input.setAttribute('accept', 'image/*')

            input.onchange = async () => {
              const file = input.files?.[0]
              if (file) {
                try {
                  const imageUrl = await handleImageUpload(file)
                  const quill = quillRef.current?.getEditor()
                  if (quill) {
                    const range = quill.getSelection(true)
                    quill.insertEmbed(range.index, 'image', imageUrl, 'user')
                    quill.setSelection(range.index + 1)
                  }
                } catch (error: any) {
                  // handleImageUpload가 이미 토스트 에러 메시지를 처리하므로 추가 처리 불필요
                  console.error('[QuillEditor] 이미지 업로드 실패:', error)
                }
              }
            }

            input.click()
          },
        },
      },
      clipboard: {
        matchVisual: false,
      },
    }),
    [handleImageUpload]
  )

  // 허용할 포맷 (보안상 제한)
  const formats = [
    'header',
    'bold',
    'italic',
    'underline',
    'strike',
    'list',
    'align',
    'link',
    'image',
    'blockquote',
    'code-block',
  ]

  // 드래그 앤 드롭 핸들러
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter(file => file.type.startsWith('image/'))

      if (imageFiles.length > 0) {
        const quill = quillRef.current?.getEditor()
        if (quill) {
          try {
            for (const file of imageFiles) {
              const imageUrl = await handleImageUpload(file)
              const range = quill.getSelection(true)
              quill.insertEmbed(range.index, 'image', imageUrl, 'user')
              quill.setSelection(range.index + 1)
            }
          } catch (error: any) {
            // handleImageUpload가 이미 토스트 에러 메시지를 처리하므로 추가 처리 불필요
            console.error('[QuillEditor] 이미지 업로드 실패:', error)
          }
        }
      }
    },
    [handleImageUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div className="quill-editor-container" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* 업로드 진행 상태 표시 */}
      {uploadStatus.isUploading && (
        <div className="upload-status-bar">
          <div className="upload-progress">
            <div className="upload-spinner">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            </div>
            <span className="upload-text">{uploadStatus.fileName} 업로드 중...</span>
          </div>
        </div>
      )}

      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        forwardedRef={quillRef}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled || uploadStatus.isUploading}
        style={{ minHeight: 'auto' }}
      />
      <style jsx global>{`
        .quill-editor-container {
          max-width: 100%;
          word-wrap: break-word;
          overflow-wrap: anywhere;
          overflow: visible;
        }

        /* 업로드 상태 바 스타일 */
        .upload-status-bar {
          background: linear-gradient(90deg, #e3f2fd 0%, #f3e5f5 100%);
          border: 1px solid #2196f3;
          border-radius: 8px 8px 0 0;
          padding: 12px 16px;
          margin-bottom: -1px;
          z-index: 10;
          position: relative;
        }

        .upload-progress {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .upload-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .upload-text {
          font-size: 14px;
          font-weight: 500;
          color: #1976d2;
        }

        .quill-editor-container .ql-container {
          font-family:
            'Pretendard',
            -apple-system,
            BlinkMacSystemFont,
            system-ui,
            Roboto,
            'Helvetica Neue',
            'Segoe UI',
            'Apple SD Gothic Neo',
            'Noto Sans KR',
            'Malgun Gothic',
            'Apple Color Emoji',
            'Segoe UI Emoji',
            'Segoe UI Symbol',
            sans-serif;
          font-size: 14px;
          line-height: 1.6;
        }

        .quill-editor-container .ql-editor {
          min-height: 120px;
          max-height: min(60vh, 500px);
          padding: 12px 15px;
          overflow-y: auto;
          resize: none;
          box-sizing: border-box;
          transition: height 0.2s ease;
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }

        .quill-editor-container .ql-toolbar {
          border-top: 1px solid #d1d5db;
          border-left: 1px solid #d1d5db;
          border-right: 1px solid #d1d5db;
          border-radius: 0.5rem 0.5rem 0 0;
          background: #f9fafb;
          padding: 8px;
        }

        .quill-editor-container .ql-container {
          border-bottom: 1px solid #d1d5db;
          border-left: 1px solid #d1d5db;
          border-right: 1px solid #d1d5db;
          border-radius: 0 0 0.5rem 0.5rem;
          background: white;
          height: auto !important;
          overflow: visible;
        }

        .quill-editor-container .ql-toolbar .ql-formats {
          margin-right: 8px;
        }

        .quill-editor-container .ql-toolbar button:hover {
          color: #2563eb;
        }

        .quill-editor-container .ql-toolbar button.ql-active {
          color: #2563eb;
        }

        .quill-editor-container .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }

        /* 이미지 스타일링 */
        .quill-editor-container .ql-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 0.375rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        /* 링크 스타일링 */
        .quill-editor-container .ql-editor a {
          color: #2563eb;
          text-decoration: underline;
          text-underline-offset: 0.2em;
          text-decoration-thickness: 1px;
          text-decoration-skip-ink: auto;
          transition: all 0.2s ease;
        }

        .quill-editor-container .ql-editor a:hover {
          text-underline-offset: 0.25em;
          text-decoration-thickness: 1.5px;
          color: #1d4ed8;
        }

        /* 블록 인용 스타일링 */
        .quill-editor-container .ql-editor blockquote {
          border-left: 4px solid #e5e7eb;
          padding-left: 16px;
          margin: 16px 0;
          color: #6b7280;
          font-style: italic;
        }

        /* 코드 블록 스타일링 */
        .quill-editor-container .ql-editor pre {
          background-color: #f3f4f6;
          border-radius: 0.375rem;
          padding: 12px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          overflow-x: auto;
          max-width: 100%;
          word-break: break-all;
          overflow-wrap: anywhere;
        }

        /* 인라인 코드 스타일링 */
        .quill-editor-container .ql-editor code {
          background-color: #f3f4f6;
          padding: 2px 4px;
          border-radius: 0.25rem;
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }

        /* 얇고 세련된 커스텀 스크롤바 */
        .quill-editor-container .ql-editor::-webkit-scrollbar {
          width: 4px;
        }

        .quill-editor-container .ql-editor::-webkit-scrollbar-track {
          background: transparent;
        }

        .quill-editor-container .ql-editor::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3);
          border-radius: 2px;
          transition:
            background 0.2s ease,
            opacity 0.2s ease;
        }

        .quill-editor-container .ql-editor::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 114, 128, 0.5);
        }

        /* 스크롤바 자동 숨김/표시 효과 */
        .quill-editor-container .ql-editor:not(:hover)::-webkit-scrollbar-thumb {
          opacity: 0.6;
        }

        .quill-editor-container .ql-editor:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        /* 반응형 높이 최적화 */
        @media (max-width: 640px) {
          .quill-editor-container .ql-editor {
            max-height: min(40vh, 350px);
            min-height: 100px;
          }
        }

        @media (min-width: 641px) and (max-width: 1024px) {
          .quill-editor-container .ql-editor {
            max-height: min(50vh, 450px);
          }
        }

        @media (min-width: 1025px) {
          .quill-editor-container .ql-editor {
            max-height: min(60vh, 500px);
          }
        }

        /* 스크롤 힌트 그라데이션 */
        .quill-editor-container .ql-editor::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 20px;
          background: linear-gradient(transparent, rgba(255, 255, 255, 0.8));
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .quill-editor-container .ql-editor.scrollable::after {
          opacity: 1;
        }

        /* 비활성화 상태 */
        .quill-editor-container.disabled .ql-toolbar {
          pointer-events: none;
          opacity: 0.6;
        }

        .quill-editor-container.disabled .ql-editor {
          background-color: #f9fafb;
          cursor: not-allowed;
          resize: none;
        }
      `}</style>
    </div>
  )
}

export default QuillEditor
