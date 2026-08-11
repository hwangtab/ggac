'use client'

import { useEffect, useState } from 'react'

/**
 * 이 브라우저가 프레임을 제때 그리고 있는지 짧게 재서 알려준다.
 *
 * 왜 필요한가: 히어로의 전체화면 장식(그레인·워시)은 GPU 합성이 켜져 있으면
 * 공짜에 가깝지만, 꺼져 있으면 합성이 CPU로 내려와 (겹친 전체화면 레이어 수 ×
 * 화면 픽셀)만큼의 블렌딩을 매 프레임 CPU가 떠안는다. 이때는 CPU가 아무리
 * 빨라도 소용이 없다 — 실측에서 CPU를 4배 느리게 해도 13.9 → 11.5fps로 거의
 * 변하지 않았다. 즉 기기 사양으로는 판별할 수 없고, 실제 프레임을 재는 수밖에 없다.
 *
 * 측정 결과 QHD·소프트웨어 합성에서 18.8fps였고, 전체화면 애니메이션만 멈추면
 * 57.5fps가 됐다. 그림은 그대로 남으므로 잃는 것은 미세한 흔들림뿐이다.
 *
 * 하이드레이션 직후 몇 프레임은 어떤 기기에서도 느리므로 warmup 동안 버린다.
 */
export function useFrameBudget(options: { disabled?: boolean } = {}): boolean {
  const { disabled } = options
  const [starved, setStarved] = useState(false)

  useEffect(() => {
    if (disabled) return
    if (typeof requestAnimationFrame !== 'function') return

    const WARMUP_MS = 700
    const SAMPLE_MS = 1000
    // 24ms = 약 42fps. 이보다 느린 프레임이 절반을 넘으면 합성이 못 따라오는 것으로 본다.
    const SLOW_FRAME_MS = 24
    const SLOW_RATIO = 0.5

    let raf = 0
    let last = performance.now()
    const start = last
    let frames = 0
    let slow = 0

    const tick = (now: number) => {
      const delta = now - last
      last = now
      const elapsed = now - start

      if (elapsed > WARMUP_MS) {
        frames++
        if (delta > SLOW_FRAME_MS) slow++
      }

      if (elapsed < WARMUP_MS + SAMPLE_MS) {
        raf = requestAnimationFrame(tick)
        return
      }
      // 표본이 너무 적으면(탭이 백그라운드였던 경우 등) 판단하지 않는다.
      if (frames >= 10 && slow / frames > SLOW_RATIO) setStarved(true)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [disabled])

  return starved
}
