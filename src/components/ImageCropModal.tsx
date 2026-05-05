'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { FiX, FiRotateCcw, FiCheck, FiMove, FiMaximize2 } from 'react-icons/fi'

interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

interface ImageCropModalProps {
  isOpen: boolean
  imageUrl: string
  imageName: string
  onClose: () => void
  onCrop: (croppedImageBlob: Blob, cropArea: CropArea) => void
  aspectRatio?: number // width/height 비율 (예: 16/9, 1 등)
}

const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageUrl,
  imageName,
  onClose,
  onCrop,
  aspectRatio,
}) => {
  const [cropArea, setCropArea] = useState<CropArea>({
    x: 50,
    y: 50,
    width: 200,
    height: 200,
  })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 이미지 로드 완료 시 초기 크롭 영역 설정
  const handleImageLoad = useCallback(
    (img?: HTMLImageElement | null) => {
      const target = img || imageRef.current
      if (!target) return

      const { naturalWidth, naturalHeight } = target
      setImageSize({ width: naturalWidth, height: naturalHeight })

      const displayWidth = target.clientWidth
      const displayHeight = target.clientHeight

      const initialSize = Math.min(displayWidth, displayHeight) * 0.6
      setCropArea({
        x: (displayWidth - initialSize) / 2,
        y: (displayHeight - initialSize) / 2,
        width: initialSize,
        height: aspectRatio ? initialSize / aspectRatio : initialSize,
      })

      setImageLoaded(true)
    },
    [aspectRatio]
  )

  // 마우스 다운 - 드래그 시작
  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'move' | 'resize') => {
    e.preventDefault()
    setDragStart({ x: e.clientX, y: e.clientY })

    if (type === 'move') {
      setIsDragging(true)
    } else {
      setIsResizing(true)
    }
  }, [])

  // 마우스 이동 - 드래그/리사이즈
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging && !isResizing) return

      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y

      if (isDragging) {
        setCropArea(prev => ({
          ...prev,
          x: Math.max(0, Math.min(prev.x + deltaX, imageRef.current!.clientWidth - prev.width)),
          y: Math.max(0, Math.min(prev.y + deltaY, imageRef.current!.clientHeight - prev.height)),
        }))
      } else if (isResizing) {
        setCropArea(prev => {
          const newWidth = Math.max(50, prev.width + deltaX)
          const newHeight = aspectRatio
            ? newWidth / aspectRatio
            : Math.max(50, prev.height + deltaY)

          return {
            ...prev,
            width: Math.min(newWidth, imageRef.current!.clientWidth - prev.x),
            height: Math.min(newHeight, imageRef.current!.clientHeight - prev.y),
          }
        })
      }

      setDragStart({ x: e.clientX, y: e.clientY })
    },
    [isDragging, isResizing, dragStart, aspectRatio]
  )

  // 마우스 업 - 드래그 종료
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsResizing(false)
  }, [])

  // 크롭 실행
  const handleCrop = useCallback(async () => {
    if (!imageRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 실제 이미지 크기와 화면 표시 크기의 비율 계산
    const scaleX = imageSize.width / imageRef.current.clientWidth
    const scaleY = imageSize.height / imageRef.current.clientHeight

    // 실제 크롭 영역 계산
    const actualCropArea = {
      x: cropArea.x * scaleX,
      y: cropArea.y * scaleY,
      width: cropArea.width * scaleX,
      height: cropArea.height * scaleY,
    }

    // 캔버스 크기 설정
    canvas.width = actualCropArea.width
    canvas.height = actualCropArea.height

    // 이미지 크롭하여 캔버스에 그리기
    ctx.drawImage(
      imageRef.current,
      actualCropArea.x,
      actualCropArea.y,
      actualCropArea.width,
      actualCropArea.height,
      0,
      0,
      actualCropArea.width,
      actualCropArea.height
    )

    // Blob으로 변환
    canvas.toBlob(
      blob => {
        if (blob) {
          onCrop(blob, actualCropArea)
        }
      },
      'image/jpeg',
      0.9
    )
  }, [cropArea, imageSize, onCrop])

  // 크롭 영역 리셋
  const handleReset = useCallback(() => {
    if (imageRef.current) {
      const displayWidth = imageRef.current.clientWidth
      const displayHeight = imageRef.current.clientHeight
      const initialSize = Math.min(displayWidth, displayHeight) * 0.6

      setCropArea({
        x: (displayWidth - initialSize) / 2,
        y: (displayHeight - initialSize) / 2,
        width: initialSize,
        height: aspectRatio ? initialSize / aspectRatio : initialSize,
      })
    }
  }, [aspectRatio])

  if (!isOpen) return null

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-crop-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-4xl max-h-[90vh] w-full mx-4 flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 id="image-crop-modal-title" className="text-lg font-semibold text-gray-900">
            이미지 크롭 - {imageName}
          </h3>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
            aria-label="이미지 크롭 모달 닫기"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* 크롭 영역 */}
        <div className="flex-1 p-6 overflow-hidden">
          <div className="relative inline-block max-w-full max-h-full">
            <Image
              ref={imageRef}
              src={imageUrl}
              alt={imageName || '크롭할 이미지'}
              width={1024}
              height={768}
              className="max-w-full max-h-[60vh] object-contain"
              unoptimized
              priority
              onLoadingComplete={handleImageLoad}
            />

            {imageLoaded && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500 bg-opacity-20 cursor-move"
                style={{
                  left: cropArea.x,
                  top: cropArea.y,
                  width: cropArea.width,
                  height: cropArea.height,
                }}
                onMouseDown={e => handleMouseDown(e, 'move')}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                {/* 크기 조절 핸들 */}
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 bg-blue-500 cursor-se-resize"
                  onMouseDown={e => {
                    e.stopPropagation()
                    handleMouseDown(e, 'resize')
                  }}
                >
                  <FiMaximize2 className="w-3 h-3 text-white" />
                </div>

                {/* 이동 아이콘 */}
                <div className="absolute top-1 left-1 text-white">
                  <FiMove className="w-4 h-4" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 버튼 영역 */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <button
            onClick={handleReset}
            className="flex items-center px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRotateCcw className="w-4 h-4 mr-2" />
            리셋
          </button>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleCrop}
              disabled={!imageLoaded}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FiCheck className="w-4 h-4 mr-2" />
              크롭 적용
            </button>
          </div>
        </div>
      </div>

      {/* 숨겨진 캔버스 - 크롭 처리용 */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

export default ImageCropModal
