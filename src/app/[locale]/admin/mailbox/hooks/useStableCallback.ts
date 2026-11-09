import { useCallback, useRef } from 'react'

/**
 * 항상 최신 클로저를 부르지만 참조는 바뀌지 않는 콜백. 메모한 목록 행에 넘겨, 부모가 다시 그려져도(메모를 입력할
 * 때마다) 행이 다시 그려지지 않게 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, [])
}
