'use client'

import React, { useMemo, useRef, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import 'react-quill-new/dist/quill.snow.css'
import toast from 'react-hot-toast'
import { useImageUpload } from '@/hooks/useImageUpload'

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
  const hasAppliedTypographyRef = useRef(false)
  const isNormalizingRef = useRef(false)
  const { uploadStatus, uploadImage } = useImageUpload()
  const normalizeEmptyParagraphs = useCallback((html: string) => {
    if (!html) return html
    return html
      .replace(/<p[^>]*data-empty-line="true"[^>]*>\s*<\/p>/gi, '<p data-empty-line="true"></p>')
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '<p data-empty-line="true"></p>')
      .replace(/(?:<p data-empty-line="true"><\/p>){2,}/gi, '<p data-empty-line="true"></p>')
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

  const getEditorInstance = useCallback(() => {
    const editor = quillRef.current?.getEditor?.()
    if (!editor) {
      throw new Error('Quill editor is not ready')
    }
    return editor
  }, [])

  const handleEditorChange = useCallback(
    (content: string) => {
      if (isNormalizingRef.current) {
        isNormalizingRef.current = false
        onChange(content)
        return
      }

      const normalized = normalizeEmptyParagraphs(content)

      if (normalized !== content) {
        try {
          const quill = getEditorInstance()
          const range = quill.getSelection()
          const delta = quill.clipboard.convert(normalized)
          isNormalizingRef.current = true
          quill.setContents(delta, 'silent')
          if (range) {
            quill.setSelection(range)
          }
        } catch (error) {
          console.error('[QuillEditor] 에디터 콘텐츠 정규화 실패:', error)
        }
        onChange(normalized)
        return
      }

      onChange(content)
    },
    [normalizeEmptyParagraphs, getEditorInstance, onChange]
  )

  const insertImageToEditor = useCallback(
    (imageUrl: string): boolean => {
      try {
        const quill = getEditorInstance()
        const selection = quill.getSelection(true)
        const insertionIndex =
          selection && typeof selection.index === 'number' ? selection.index : quill.getLength()

        quill.focus()
        quill.insertEmbed(insertionIndex, 'image', imageUrl, 'user')
        quill.setSelection(insertionIndex + 1, 0)
        return true
      } catch (error) {
        console.error('[QuillEditor] 이미지 삽입 실패:', error)
        return false
      }
    },
    [getEditorInstance]
  )

  const handleSelectionChange = useCallback((_range: any, _source: any, editor: any) => {
    if (hasAppliedTypographyRef.current || !editor?.root) return
    editor.root.classList.add('prose', 'max-w-none')
    hasAppliedTypographyRef.current = true
  }, [])

  const buildUploadErrorMessage = (error: unknown) => {
    const baseMessage = '이미지 업로드에 실패했습니다.'
    if (!(error instanceof Error)) return baseMessage
    const message = error.message || ''
    if (message.includes('파일 크기')) {
      return '이미지 파일 크기가 너무 큽니다. 5MB 이하의 이미지를 선택해주세요.'
    }
    if (message.includes('파일 형식') || message.includes('지원하지 않는')) {
      return '지원하지 않는 이미지 형식입니다. JPG, PNG, GIF, WebP 파일만 업로드 가능합니다.'
    }
    if (message.includes('네트워크') || message.includes('서버')) {
      return '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    }
    if (message.includes('권한')) {
      return '파일 업로드 권한이 없습니다. 로그인 상태를 확인해주세요.'
    }
    return baseMessage
  }

  const processImageFile = useCallback(
    async (file: File) => {
      const toastId = toast.loading(`${file.name} 업로드 중...`)
      try {
        const imageUrl = await uploadImage(file)
        const insertSuccess = insertImageToEditor(imageUrl)

        if (insertSuccess) {
          toast.success(`${file.name} 업로드 및 삽입 완료!`, { id: toastId })
        } else {
          toast.error('이미지 업로드는 성공했지만 에디터에 삽입하지 못했습니다.', { id: toastId })
        }
      } catch (error) {
        console.error('[QuillEditor] 이미지 업로드 실패:', error)
        toast.error(buildUploadErrorMessage(error), { id: toastId })
      }
    },
    [insertImageToEditor, uploadImage]
  )

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
                await processImageFile(file)
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
    [processImageFile]
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
    'break', // 줄바꿈 처리를 위해 추가
  ]

  // 드래그 앤 드롭 핸들러
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter(file => file.type.startsWith('image/'))

      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          await processImageFile(file)
        }
      }
    },
    [processImageFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const containerClassName = [
    'quill-editor-container',
    disabled || uploadStatus.isUploading ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={containerClassName} onDrop={handleDrop} onDragOver={handleDragOver}>
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
        onChange={handleEditorChange}
        forwardedRef={quillRef}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled || uploadStatus.isUploading}
        style={{ minHeight: 'auto' }}
        onChangeSelection={handleSelectionChange}
      />
    </div>
  )
}

export default QuillEditor
