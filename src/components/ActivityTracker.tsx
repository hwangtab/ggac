'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import activityLogger from '@/utils/activityLogger'

interface ActivityTrackerProps {
  children: React.ReactNode
}

export default function ActivityTracker({ children }: ActivityTrackerProps) {
  const pathname = usePathname()

  useEffect(() => {
    // 페이지 뷰 활동 로깅
    const logPageView = async () => {
      try {
        await activityLogger.logPageView(pathname, {
          referrer: document.referrer || 'direct'
        })
      } catch (error) {
        // 활동 로깅 실패는 사용자 경험에 영향을 주지 않도록 조용히 처리
        console.debug('Page view logging failed:', error)
      }
    }

    logPageView()
  }, [pathname])

  return <>{children}</>
}