'use client'

import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import 'react-quill-new/dist/quill.snow.css'
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation'
import toast from 'react-hot-toast'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const EDITOR_WAIT_INTERVAL = 100
const MAX_EDITOR_WAIT_ATTEMPTS = 30

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

  // 렌더러와 동일한 타이포그래피 적용
  useEffect(() => {
    if (typeof window === 'undefined') return

    let rafId: number | null = null
    let attempts = 0
    const maxAttempts = 30

    const applyTypographyClass = () => {
      const quillInstance = quillRef.current?.getEditor?.()
      const editorRoot = quillInstance?.root as HTMLElement | undefined

      if (editorRoot) {
        editorRoot.classList.remove('prose', 'max-w-none')
        editorRoot.classList.add('editor-content')
        return
      }

      if (attempts < maxAttempts) {
        attempts += 1
        rafId = window.requestAnimationFrame(applyTypographyClass)
      }
    }

    applyTypographyClass()

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [])

  const waitForQuillEditor = useCallback(async () => {
    let attempts = 0

    while (attempts < MAX_EDITOR_WAIT_ATTEMPTS) {
      const editor = quillRef.current?.getEditor?.()
      if (editor) {
        return editor
      }
      attempts += 1
      await sleep(EDITOR_WAIT_INTERVAL)
    }

    throw new Error('Quill editor not ready')
  }, [])

  // 에디터에 이미지 삽입하는 헬퍼 함수
  const insertImageToEditor = useCallback(
    async (imageUrl: string): Promise<boolean> => {
      try {
        const quill = await waitForQuillEditor()
        const selection = quill.getSelection(true)
        const insertionIndex =
          selection && typeof selection.index === 'number'
            ? selection.index
            : Math.max(0, quill.getLength() - 1)

        quill.focus()
        quill.insertEmbed(insertionIndex, 'image', imageUrl, 'user')
        quill.setSelection(insertionIndex + 1, 0)
        return true
      } catch (error) {
        console.error('[QuillEditor] 이미지 삽입 중 오류 발생, 에디터 끝에 삽입 시도', error)

        try {
          const quill = await waitForQuillEditor()
          const fallbackIndex = quill.getLength()
          quill.insertEmbed(fallbackIndex, 'image', imageUrl, 'user')
          quill.setSelection(fallbackIndex + 1, 0)
          return true
        } catch (fallbackError) {
          console.error('[QuillEditor] 이미지 삽입에 실패했습니다.', fallbackError)
          return false
        }
      }
    },
    [waitForQuillEditor]
  )

  // 이미지 업로드 핸들러 (토스트 없는 순수 업로드 함수)
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    // 업로드 상태 시작
    setUploadStatus({
      isUploading: true,
      fileName: file.name,
    })

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

      return result.public_url
    } catch (error) {
      console.error('[QuillEditor] 이미지 업로드 오류:', error)
      throw error
    } finally {
      setUploadStatus({
        isUploading: false,
        fileName: null,
      })
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
                const toastId = toast.loading(`${file.name} 업로드 중...`)
                try {
                  const imageUrl = await handleImageUpload(file)

                  // 에디터에 이미지 삽입 시도 (비동기)
                  const insertSuccess = await insertImageToEditor(imageUrl)

                  if (insertSuccess) {
                    toast.success(`${file.name} 업로드 및 삽입 완료!`, {
                      id: toastId,
                    })
                  } else {
                    toast.error('이미지 업로드는 성공했지만 에디터에 삽입하지 못했습니다.', {
                      id: toastId,
                    })
                  }
                } catch (error: any) {
                  console.error('[QuillEditor] 이미지 업로드 실패:', error)

                  // 사용자 친화적인 에러 메시지
                  let userMessage = '이미지 업로드에 실패했습니다.'
                  const errorMessage = error instanceof Error ? error.message : String(error)

                  if (errorMessage.includes('파일 크기')) {
                    userMessage =
                      '이미지 파일 크기가 너무 큽니다. 5MB 이하의 이미지를 선택해주세요.'
                  } else if (
                    errorMessage.includes('파일 형식') ||
                    errorMessage.includes('지원하지 않는')
                  ) {
                    userMessage =
                      '지원하지 않는 이미지 형식입니다. JPG, PNG, GIF, WebP 파일만 업로드 가능합니다.'
                  } else if (errorMessage.includes('네트워크') || errorMessage.includes('서버')) {
                    userMessage = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
                  } else if (errorMessage.includes('권한')) {
                    userMessage = '파일 업로드 권한이 없습니다. 로그인 상태를 확인해주세요.'
                  }

                  toast.error(userMessage, {
                    id: toastId,
                  })
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
    [handleImageUpload, insertImageToEditor]
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
        console.log('[QuillEditor] 드래그 앤 드롭으로', imageFiles.length, '개 이미지 처리 시작')

        for (const file of imageFiles) {
          const toastId = toast.loading(`${file.name} 업로드 중...`)
          try {
            const imageUrl = await handleImageUpload(file)

            // 에디터에 이미지 삽입 시도 (비동기)
            const insertSuccess = await insertImageToEditor(imageUrl)

            if (insertSuccess) {
              toast.success(`${file.name} 업로드 및 삽입 완료!`, {
                id: toastId,
              })
            } else {
              toast.error('이미지 업로드는 성공했지만 에디터에 삽입하지 못했습니다.', {
                id: toastId,
              })
            }
          } catch (error: any) {
            console.error('[QuillEditor] 이미지 업로드 실패:', error)

            // 사용자 친화적인 에러 메시지
            let userMessage = '이미지 업로드에 실패했습니다.'
            const errorMessage = error instanceof Error ? error.message : String(error)

            if (errorMessage.includes('파일 크기')) {
              userMessage = '이미지 파일 크기가 너무 큽니다. 5MB 이하의 이미지를 선택해주세요.'
            } else if (
              errorMessage.includes('파일 형식') ||
              errorMessage.includes('지원하지 않는')
            ) {
              userMessage =
                '지원하지 않는 이미지 형식입니다. JPG, PNG, GIF, WebP 파일만 업로드 가능합니다.'
            } else if (errorMessage.includes('네트워크') || errorMessage.includes('서버')) {
              userMessage = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
            } else if (errorMessage.includes('권한')) {
              userMessage = '파일 업로드 권한이 없습니다. 로그인 상태를 확인해주세요.'
            }

            toast.error(userMessage, {
              id: toastId,
            })
          }
        }
      }
    },
    [handleImageUpload, insertImageToEditor]
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
        onChange={onChange}
        forwardedRef={quillRef}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled || uploadStatus.isUploading}
        style={{ minHeight: 'auto' }}
      />
    </div>
  )
}

export default QuillEditor
