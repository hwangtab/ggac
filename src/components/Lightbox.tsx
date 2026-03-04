'use client'

import { useEffect, useRef } from 'react'
import { FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import OptimizedImage from './OptimizedImage'

interface LightboxProps {
  images: string[]
  currentIndex: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

const Lightbox = ({ images, currentIndex, onClose, onNext, onPrev }: LightboxProps) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus close button when modal opens
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onNext()
      if (e.key === 'ArrowLeft') onPrev()

      // Focus trap: keep Tab/Shift+Tab within the dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
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
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onNext, onPrev])

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center animate-fade-in"
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`갤러리 이미지 ${currentIndex + 1} / ${images.length}`}
    >
      {/* Close Button */}
      <button
        ref={closeButtonRef}
        onClick={onClose}
        aria-label="닫기"
        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-50"
      >
        <FiX size={32} />
      </button>

      {/* Main Image */}
      <div className="relative w-full h-full max-w-4xl max-h-[90vh] flex items-center justify-center px-6">
        <OptimizedImage
          src={images[currentIndex]}
          alt={`갤러리 이미지 ${currentIndex + 1}`}
          width={1600}
          height={900}
          className="w-full h-auto max-h-[90vh] object-contain mx-auto"
          suppressSkeleton
          quality={90}
          sizes="(max-width: 768px) 100vw, 80vw"
        />
      </div>

      {/* Prev Button */}
      <button
        onClick={onPrev}
        aria-label="이전 이미지"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors bg-black/30 rounded-full p-2"
      >
        <FiChevronLeft size={32} />
      </button>

      {/* Next Button */}
      <button
        onClick={onNext}
        aria-label="다음 이미지"
        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors bg-black/30 rounded-full p-2"
      >
        <FiChevronRight size={32} />
      </button>

      {/* Counter */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full"
        aria-live="polite"
        aria-atomic="true"
      >
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  )
}

export default Lightbox
