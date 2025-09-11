'use client'

import { useEffect, useState } from 'react'
import BoardClient from './BoardClient'
import type { Post } from '@/types'

interface InitialPostsData {
  posts: Post[]
  hasNext: boolean
  nextCursor: string | null
}

interface BoardClientBridgeProps {
  postId?: string
  refreshKey?: string
}

// 클라이언트 컴포넌트: 서버에서 주입한 초기 데이터를 DOM에서 읽어와 BoardClient에 전달
export default function BoardClientBridge({ postId, refreshKey }: BoardClientBridgeProps = {}) {
  const [initialData, setInitialData] = useState<InitialPostsData | undefined>(undefined)
  const [isDataLoaded, setIsDataLoaded] = useState(false)

  useEffect(() => {
    // 서버에서 제공한 초기 데이터 읽기
    try {
      const initialDataScript = document.getElementById('initial-posts-data')?.textContent

      if (initialDataScript) {
        const parsedData = JSON.parse(initialDataScript) as InitialPostsData
        console.log(
          '📥 [BoardClientBridge] 서버 초기 데이터 로드됨:',
          parsedData.posts.length,
          '개 게시물'
        )
        setInitialData(parsedData)
      } else {
        console.warn('⚠️ [BoardClientBridge] 서버 초기 데이터가 없습니다. API 호출로 폴백합니다.')
      }
    } catch (error) {
      console.error('❌ [BoardClientBridge] 초기 데이터 파싱 오류:', error)
    } finally {
      setIsDataLoaded(true)
    }
  }, [refreshKey]) // refreshKey 변경 시 데이터 재로드

  // 데이터 로딩이 완료되지 않았으면 로딩 표시
  if (!isDataLoaded) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
        <div className="text-gray-600">게시판을 로드하는 중...</div>
      </div>
    )
  }

  return <BoardClient initialData={initialData} />
}
