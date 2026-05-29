'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BOARD_DOCUMENT_CATEGORIES } from '@/constants/boardRoom'

interface DocumentUploadProps {
  onUploaded: () => void
}

export default function DocumentUpload({ onUploaded }: DocumentUploadProps) {
  const t = useTranslations('boardRoom.documents')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [uploading, setUploading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const resetForm = () => {
    setFile(null)
    setTitle('')
    setCategory('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    setApiError(null)

    if (!file) {
      setValidationError(t('validationFile'))
      return
    }
    if (!title.trim()) {
      setValidationError(t('validationTitle'))
      return
    }
    if (!category) {
      setValidationError(t('validationCategory'))
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title.trim())
      formData.append('category', category)

      // Note: do NOT set Content-Type — the browser sets the multipart boundary.
      const res = await fetch('/api/board-room/documents', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (json.success) {
        resetForm()
        onUploaded()
      } else {
        setApiError(json.error || t('errorGeneric'))
      }
    } catch {
      setApiError(t('errorGeneric'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 md:p-6 space-y-4"
    >
      <h2 className="text-base font-semibold text-gray-900">{t('uploadTitle')}</h2>

      {/* 파일 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="doc-file">
          {t('fileLabel')} <span className="text-red-500">*</span>
        </label>
        <input
          id="doc-file"
          ref={fileInputRef}
          type="file"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
        />
        <p className="text-xs text-gray-400 mt-1">{t('sizeLimit')}</p>
      </div>

      {/* 제목 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="doc-title">
          {t('titleLabel')} <span className="text-red-500">*</span>
        </label>
        <input
          id="doc-title"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>

      {/* 분류 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="doc-category">
          {t('categoryLabel')} <span className="text-red-500">*</span>
        </label>
        <select
          id="doc-category"
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm bg-white"
        >
          <option value="">{t('categoryPlaceholder')}</option>
          {BOARD_DOCUMENT_CATEGORIES.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {validationError && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          {validationError}
        </div>
      )}
      {apiError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {apiError}
        </div>
      )}

      <button
        type="submit"
        disabled={uploading}
        className="w-full sm:w-auto px-6 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? t('uploading') : t('submit')}
      </button>
    </form>
  )
}
