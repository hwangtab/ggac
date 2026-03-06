'use client'

import React, { useRef } from 'react'
import { FiUpload, FiX, FiImage, FiFile, FiVideo, FiMusic, FiPaperclip } from 'react-icons/fi'

interface FileUploadAreaProps {
  selectedFiles: File[]
  isDragOver: boolean
  maxFiles: number
  onFileSelect: (files: FileList) => void
  onRemoveFile: (index: number) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  getFileIcon: (fileType: string) => string
  formatFileSize: (bytes: number) => string
}

const iconMap = {
  image: FiImage,
  video: FiVideo,
  audio: FiMusic,
  file: FiFile,
}

export const FileUploadArea: React.FC<FileUploadAreaProps> = ({
  selectedFiles,
  isDragOver,
  maxFiles,
  onFileSelect,
  onRemoveFile,
  onDragOver,
  onDragLeave,
  onDrop,
  getFileIcon,
  formatFileSize,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files)
      e.target.value = '' // 같은 파일을 다시 선택할 수 있도록 초기화
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-4">
      {/* 파일 업로드 영역 */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
        `}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={handleUploadClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleInputChange}
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
        />

        <div className="flex flex-col items-center">
          <FiUpload className="w-8 h-8 text-gray-400 mb-2" />
          <p className="text-gray-600 mb-1">파일을 드래그하거나 클릭하여 업로드</p>
          <p className="text-sm text-gray-500">최대 {maxFiles}개 파일, 각각 5MB 이하</p>
          <p className="text-xs text-gray-400 mt-1">이미지, 동영상, 음성, PDF, DOC 파일 지원</p>
        </div>
      </div>

      {/* 선택된 파일 목록 */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900">첨부파일 ({selectedFiles.length}개)</h4>
          <div className="space-y-2">
            {selectedFiles.map((file, index) => {
              const iconType = getFileIcon(file.type)
              const IconComponent = iconMap[iconType as keyof typeof iconMap]

              return (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <IconComponent className="w-5 h-5 text-gray-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      onRemoveFile(index)
                    }}
                    className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 transition-colors"
                    title="파일 제거"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
