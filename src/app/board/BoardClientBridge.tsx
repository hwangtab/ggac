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
    const loadInitialData = () => {
      try {
        const initialDataScript = document.getElementById('initial-posts-data')

        if (!initialDataScript) {
          console.warn(
            '⚠️ [BoardClientBridge] initial-posts-data 스크립트 태그를 찾을 수 없습니다.'
          )
          return null
        }

        const scriptContent = initialDataScript.textContent
        if (!scriptContent || scriptContent.trim() === '') {
          console.warn('⚠️ [BoardClientBridge] 스크립트 태그가 비어있습니다.')
          return null
        }

        const parsedData = JSON.parse(scriptContent) as InitialPostsData
        console.log(
          '📥 [BoardClientBridge] 서버 초기 데이터 로드됨:',
          parsedData.posts?.length || 0,
          '개 게시물'
        )
        return parsedData
      } catch (error) {
        console.error('❌ [BoardClientBridge] 초기 데이터 파싱 오류:', error)
        return null
      }
    }

    // 즉시 시도 + 재시도/감시 로직 (스트리밍 렌더 대응)
    let data = loadInitialData()
    if (data) {
      setInitialData(data)
      setIsDataLoaded(true)
      return
    }

    console.log('🔄 [BoardClientBridge] 초기 데이터 로드 재시도 중...')
    let attempts = 0
    const maxAttempts = 20 // 최대 2초(100ms * 20) 재시도
    const interval = setInterval(() => {
      attempts++
      const d = loadInitialData()
      if (d) {
        clearInterval(interval)
        if (observer) observer.disconnect()
        setInitialData(d)
        setIsDataLoaded(true)
      } else if (attempts >= maxAttempts) {
        clearInterval(interval)
        if (observer) observer.disconnect()
        console.warn('⚠️ [BoardClientBridge] 서버 초기 데이터가 없습니다. API 호출로 폴백합니다.')
        setIsDataLoaded(true)
      }
    }, 100)

    // MutationObserver로 head/body에 스크립트 삽입 감지
    const target = document
    const observer = new MutationObserver(() => {
      const d = loadInitialData()
      if (d) {
        clearInterval(interval)
        observer.disconnect()
        setInitialData(d)
        setIsDataLoaded(true)
      }
    })
    observer.observe(target, { childList: true, subtree: true })

    return () => {
      clearInterval(interval)
      observer.disconnect()
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
