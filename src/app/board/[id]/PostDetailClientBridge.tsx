'use client'

import { useEffect, useState } from 'react'
import PostDetailClient from './PostDetailClient'

interface PostDetailClientBridgeProps {
  postId: string
}

/**
 * 서버에서 제공된 초기 데이터를 클라이언트 컴포넌트로 전달하는 브리지
 * DOM에서 초기 데이터 스크립트를 읽어와서 클라이언트 컴포넌트에 전달
 */
export default function PostDetailClientBridge({ postId }: PostDetailClientBridgeProps) {
  const [initialData, setInitialData] = useState(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // DOM에서 초기 데이터 스크립트 태그 찾기
    const scriptElement = document.getElementById('initial-post-data')

    if (scriptElement) {
      try {
        const data = JSON.parse(scriptElement.textContent || '{}')
        setInitialData(data)
      } catch (error) {
        console.error('[PostDetailClientBridge] Failed to parse initial data:', error)
      }
    }

    setIsReady(true)
  }, [])

  if (!isReady) {
    // 초기 로딩 상태
    return (
      <div className="container mx-auto px-4 pt-24 md:pt-28">
        <div className="max-w-4xl mx-auto">
          <div className="h-6 w-48 bg-gray-200 rounded mb-4 animate-pulse" />
          <div className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="w-24 h-5 bg-gray-200 rounded mb-3" />
            <div className="w-3/4 h-8 bg-gray-200 rounded mb-4" />
            <div className="w-full h-24 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    )
  }

  return <PostDetailClient postId={postId} initialData={initialData} />
}
