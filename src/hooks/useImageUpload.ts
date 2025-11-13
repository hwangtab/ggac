import { useCallback, useState } from 'react'
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation'

interface UploadStatus {
  isUploading: boolean
  fileName: string | null
}

export const useImageUpload = () => {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    fileName: null,
  })

  const uploadImage = useCallback(async (file: File): Promise<string> => {
    setUploadStatus({
      isUploading: true,
      fileName: file.name,
    })

    try {
      const validation = await validateFile(file)
      if (!validation.isValid) {
        throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`)
      }

      if (validation.fileType !== 'image') {
        throw new Error('이미지 파일만 업로드할 수 있습니다.')
      }

      const sanitizedFile = await sanitizeImageFile(file)
      const formData = new FormData()
      formData.append('file', sanitizedFile)
      formData.append('bucket', 'attachments')

      const metadata = {
        original_filename: file.name,
        file_size: file.size,
        content_type: file.type,
        uploaded_at: new Date().toISOString(),
      }
      formData.append('metadata', JSON.stringify(metadata))

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
      return result.public_url
    } finally {
      setUploadStatus({
        isUploading: false,
        fileName: null,
      })
    }
  }, [])

  return { uploadStatus, uploadImage }
}
