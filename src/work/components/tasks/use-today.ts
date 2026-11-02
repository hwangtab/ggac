'use client'

import { useEffect, useState } from 'react'
import { todaySeoul } from '@work/lib/tasks/due'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 지금부터 다음 서울 자정까지 남은 ms (+1초 여유) */
export function msUntilSeoulMidnight(now: number = Date.now()): number {
  return DAY_MS - ((now + KST_OFFSET_MS) % DAY_MS) + 1000
}

/**
 * 서울 기준 오늘. 서버가 내려준 값으로 시작(하이드레이션 일치)하고, 화면을 열어 둔 채 자정을 넘기거나
 * 잠들었다 깨어나도(visibilitychange) 새 날짜로 갱신해 "기한 지남"·"오늘 마감" 분류가 낡지 않게 한다.
 */
export function useSeoulToday(serverToday: string): string {
  const [today, setToday] = useState(serverToday)
  const [prevServer, setPrevServer] = useState(serverToday)
  if (prevServer !== serverToday) {
    setPrevServer(serverToday)
    setToday(serverToday)
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setToday(todaySeoul())
      timer = setTimeout(tick, msUntilSeoulMidnight())
    }
    timer = setTimeout(tick, msUntilSeoulMidnight())
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday(todaySeoul())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return today
}
