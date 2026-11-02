import { useEffect, useState } from 'react'

/**
 * 터치 기기(손가락이 주 입력 장치)인가. 휴대폰에는 Shift+Enter 가 없어 줄바꿈이 불가능하므로
 * 이런 기기에서는 입력창의 Enter 를 줄바꿈으로 두고 보내기는 버튼으로 한다.
 * 서버 렌더·테스트(matchMedia 없음)에서는 false(데스크톱 동작).
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)'

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(COARSE_POINTER_QUERY)
    const update = () => setCoarse(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return coarse
}
