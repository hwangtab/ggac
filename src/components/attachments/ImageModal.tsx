'use client'

import React, { useEffect, useRef, useState } from 'react'
import { FiX } from 'react-icons/fi'
import type { PostAttachment } from '@/types'

interface ImageModalProps {
  attachment: PostAttachment
  onClose: () => void
}

export const ImageModal: React.FC<ImageModalProps> = ({ attachment, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [previousFocus, setPreviousFocus] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setPreviousFocus(document.activeElement as HTMLElement)
    closeButtonRef.current?.focus()
    return () => {
      if (previousFocus) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (focusable.length === 0) return
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
  }, [onClose])

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative max-w-4xl max-h-full">
        <h3 id="image-modal-title" className="sr-only">
          {attachment.alt_text || attachment.file_name}
        </h3>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
          aria-label="닫기"
        >
          <FiX className="w-8 h-8" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.file_url}
          alt={attachment.alt_text || attachment.file_name}
          className="max-w-full max-h-full object-contain"
        />
        {attachment.alt_text && (
          <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 text-white p-3 rounded">
            <p className="text-sm">{attachment.alt_text}</p>
          </div>
        )}
      </div>
    </div>
  )
}
