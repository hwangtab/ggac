'use client'

import React, { useEffect } from 'react'
import { FiX } from 'react-icons/fi'
import type { PostAttachment } from '@/types'

interface ImageModalProps {
  attachment: PostAttachment
  onClose: () => void
}

export const ImageModal: React.FC<ImageModalProps> = ({ attachment, onClose }) => {
  // Escape 키로 닫기 + 포커스 트랩
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.alt_text || attachment.file_name}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative max-w-4xl max-h-full">
        <button
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
