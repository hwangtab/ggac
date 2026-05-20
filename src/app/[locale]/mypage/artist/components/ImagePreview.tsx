'use client'

import { useState, useEffect } from 'react'
import { Camera, Link, AlertCircle, Check } from 'lucide-react'

interface ImagePreviewProps {
  currentImage?: string
  onImageChange: (imageUrl: string) => void
  value: string
}

type ImageStatus = 'idle' | 'loading' | 'success' | 'error'

export default function ImagePreview({ currentImage, onImageChange, value }: ImagePreviewProps) {
  const [imageUrl, setImageUrl] = useState(value || '')
  const [imageStatus, setImageStatus] = useState<ImageStatus>('idle')
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // URL 유효성 검사
  const isValidUrl = (url: string) => {
    try {
      new URL(url)
      return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)
    } catch {
      return false
    }
  }

  // 이미지 로딩 테스트
  const testImageLoad = (url: string) => {
    if (!url || !isValidUrl(url)) {
      setImageStatus('idle')
      setPreviewImage(null)
      return
    }

    setImageStatus('loading')

    const img = new Image()
    img.onload = () => {
      setImageStatus('success')
      setPreviewImage(url)
    }
    img.onerror = () => {
      setImageStatus('error')
      setPreviewImage(null)
    }
    img.src = url
  }

  // URL 입력 핸들러
  const handleUrlChange = (newUrl: string) => {
    setImageUrl(newUrl)
    onImageChange(newUrl)

    // 디바운스를 위한 타이머
    const timeoutId = setTimeout(() => {
      testImageLoad(newUrl)
    }, 500)

    return () => clearTimeout(timeoutId)
  }

  // 초기 이미지 로딩
  useEffect(() => {
    if (value) {
      testImageLoad(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="space-y-4">
      {/* 현재 이미지 표시 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">현재 프로필 이미지</label>
        <div className="flex items-center gap-4">
          {currentImage ? (
            <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentImage} alt="현재 프로필" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-lg bg-gray-100 flex items-center justify-center">
              <Camera className="w-8 h-8 text-gray-400" />
            </div>
          )}
          <div className="text-sm text-gray-500">
            {currentImage ? '현재 설정된 이미지' : '이미지가 설정되지 않음'}
          </div>
        </div>
      </div>

      {/* 새 이미지 URL 입력 */}
      <div>
        <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-2">
          새 이미지 URL
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Link className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="url"
            id="imageUrl"
            value={imageUrl}
            onChange={e => handleUrlChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {/* 상태 표시 아이콘 */}
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            {imageStatus === 'loading' && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            )}
            {imageStatus === 'success' && <Check className="h-4 w-4 text-green-500" />}
            {imageStatus === 'error' && <AlertCircle className="h-4 w-4 text-red-500" />}
          </div>
        </div>

        {/* 입력 가이드 */}
        <p className="mt-1 text-xs text-gray-500">
          JPG, PNG, GIF, WebP 형식의 이미지 URL을 입력하세요
        </p>
      </div>

      {/* 새 이미지 프리뷰 */}
      {imageUrl && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">미리보기</label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 border-2 border-dashed border-gray-300">
              {imageStatus === 'loading' && (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                </div>
              )}
              {imageStatus === 'success' && previewImage && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewImage}
                    alt="새 프로필 미리보기"
                    className="w-full h-full object-cover"
                  />
                </>
              )}
              {imageStatus === 'error' && (
                <div className="w-full h-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-red-400" />
                </div>
              )}
              {imageStatus === 'idle' && (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera className="w-6 h-6 text-gray-400" />
                </div>
              )}
            </div>
            <div className="text-sm">
              {imageStatus === 'loading' && (
                <span className="text-blue-600">이미지 로딩 중...</span>
              )}
              {imageStatus === 'success' && (
                <span className="text-green-600">이미지가 정상적으로 로드되었습니다</span>
              )}
              {imageStatus === 'error' && (
                <span className="text-red-600">이미지를 로드할 수 없습니다</span>
              )}
              {imageStatus === 'idle' && imageUrl && (
                <span className="text-gray-500">URL을 확인하는 중...</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 에러 메시지 */}
      {imageStatus === 'error' && imageUrl && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">이미지를 불러올 수 없습니다</h3>
              <div className="mt-1 text-sm text-red-700">
                <ul className="list-disc list-inside space-y-1">
                  <li>URL이 올바른지 확인해주세요</li>
                  <li>이미지 파일 형식이 지원되는지 확인해주세요 (JPG, PNG, GIF, WebP)</li>
                  <li>이미지가 공개적으로 접근 가능한지 확인해주세요</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 가이드라인 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <h4 className="text-sm font-medium text-blue-900 mb-2">이미지 가이드라인</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• 정사각형 비율 (1:1)을 권장합니다</li>
          <li>• 최소 200x200px 이상의 해상도를 권장합니다</li>
          <li>• 파일 크기는 5MB 이하를 권장합니다</li>
          <li>• 얼굴이 잘 보이는 밝은 이미지를 사용해주세요</li>
        </ul>
      </div>
    </div>
  )
}
