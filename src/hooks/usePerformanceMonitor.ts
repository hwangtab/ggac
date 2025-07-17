'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface PerformanceMetrics {
  fps: number
  avgFps: number
  memoryUsage: number
  jankCount: number
  frameTime: number
  isLowPerformance: boolean
}

interface PerformanceMonitorOptions {
  // 모니터링 활성화 여부
  enabled?: boolean
  // FPS 측정 간격 (밀리초) - 기본값 증가로 오버헤드 감소
  fpsUpdateInterval?: number
  // 메모리 측정 간격 (밀리초) - 기본값 증가로 오버헤드 감소
  memoryUpdateInterval?: number
  // 저성능 기준 FPS
  lowPerformanceThreshold?: number
  // Jank 감지 기준 프레임 시간 (밀리초)
  jankThreshold?: number
  // 성능 히스토리 유지 개수 - 메모리 사용량 감소
  historySize?: number
  // 개발 환경에서만 실행
  devOnly?: boolean
}

interface PerformanceHistory {
  timestamp: number
  fps: number
  memory: number
  frameTime: number
}

/**
 * 실시간 성능 모니터링 훅
 * FPS, 메모리 사용량, Jank 감지 등을 실시간으로 추적
 */
export const usePerformanceMonitor = (options: PerformanceMonitorOptions = {}) => {
  const {
    enabled = true,
    fpsUpdateInterval = 5000, // 5초로 증가하여 오버헤드 대폭 감소
    memoryUpdateInterval = 10000, // 10초로 증가하여 오버헤드 대폭 감소
    lowPerformanceThreshold = 30,
    jankThreshold = 16.67, // 60fps 기준
    historySize = 20, // 20개로 감소하여 메모리 절약
    devOnly = true
  } = options

  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    avgFps: 0,
    memoryUsage: 0,
    jankCount: 0,
    frameTime: 0,
    isLowPerformance: false
  })

  const [history, setHistory] = useState<PerformanceHistory[]>([])
  const [isActive, setIsActive] = useState(false)
  const isActiveRef = useRef(false)

  // FPS 계산용 ref들
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(0)
  const fpsHistoryRef = useRef<number[]>([])
  const jankCountRef = useRef(0)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const fpsIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const memoryIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // 활성화 조건 확인
  const shouldMonitor = enabled && (!devOnly || process.env.NODE_ENV === 'development')

  // FPS 측정 함수
  const measureFrame = useCallback((currentTime: number) => {
    // 활성화 상태를 런타임에 체크
    if (!enabled || (devOnly && process.env.NODE_ENV !== 'development') || !isActiveRef.current) return

    frameCountRef.current++
    
    if (lastTimeRef.current) {
      const deltaTime = currentTime - lastTimeRef.current
      
      // Jank 감지 (프레임 시간이 기준을 초과하는 경우)
      if (deltaTime > jankThreshold) {
        jankCountRef.current++
      }
    }
    
    lastTimeRef.current = currentTime
    animationFrameRef.current = requestAnimationFrame(measureFrame)
  }, [enabled, devOnly, jankThreshold])

  // FPS 계산 및 업데이트
  const updateFPS = useCallback(() => {
    // 활성화 상태를 런타임에 체크
    if (!enabled || (devOnly && process.env.NODE_ENV !== 'development') || !isActiveRef.current) return

    const now = performance.now()
    const deltaTime = now - (lastTimeRef.current || now)
    const fps = frameCountRef.current * (1000 / fpsUpdateInterval)
    
    // FPS 히스토리 관리
    fpsHistoryRef.current.push(fps)
    if (fpsHistoryRef.current.length > historySize) {
      fpsHistoryRef.current.shift()
    }

    // 평균 FPS 계산
    const avgFps = fpsHistoryRef.current.reduce((sum, f) => sum + f, 0) / fpsHistoryRef.current.length

    // 프레임 시간 계산
    const frameTime = fps > 0 ? 1000 / fps : 0

    setMetrics(prev => ({
      ...prev,
      fps: Math.round(fps),
      avgFps: Math.round(avgFps),
      frameTime: Math.round(frameTime * 100) / 100,
      jankCount: jankCountRef.current,
      isLowPerformance: fps < lowPerformanceThreshold
    }))

    // 히스토리 업데이트 - 함수형 업데이트로 의존성 제거
    setHistory(prev => {
      const newHistory = [...prev, {
        timestamp: now,
        fps: Math.round(fps),
        memory: prev[prev.length - 1]?.memory || 0,
        frameTime: Math.round(frameTime * 100) / 100
      }]
      
      return newHistory.slice(-historySize)
    })

    // 카운터 리셋
    frameCountRef.current = 0
    jankCountRef.current = 0
  }, [enabled, devOnly, fpsUpdateInterval, historySize, lowPerformanceThreshold])

  // 메모리 사용량 측정 (브라우저 호환성 개선)
  const updateMemory = useCallback(() => {
    // 활성화 상태를 런타임에 체크
    if (!enabled || (devOnly && process.env.NODE_ENV !== 'development') || !isActiveRef.current) return

    let memoryUsage = 0
    
    // Chrome/Edge - performance.memory API
    if ('memory' in performance) {
      const memoryInfo = (performance as any).memory
      const usedJSHeapSize = memoryInfo.usedJSHeapSize
      const totalJSHeapSize = memoryInfo.totalJSHeapSize
      
      // MB 단위로 변환
      memoryUsage = Math.round((usedJSHeapSize / 1024 / 1024) * 100) / 100
      
      // 개발 환경에서 메모리 경고
      if (process.env.NODE_ENV === 'development' && usedJSHeapSize / totalJSHeapSize > 0.9) {
        console.warn('⚠️ High memory usage detected:', {
          used: `${memoryUsage}MB`,
          total: `${Math.round((totalJSHeapSize / 1024 / 1024) * 100) / 100}MB`,
          percentage: `${Math.round((usedJSHeapSize / totalJSHeapSize) * 100)}%`
        })
      }
    }
    // Firefox/Safari 대체 메모리 추정
    else {
      // Performance 엔트리를 이용한 메모리 사용량 추정
      const perfEntries = performance.getEntriesByType('measure')
      const resourceEntries = performance.getEntriesByType('resource')
      const frameCount = frameCountRef.current || 1
      
      // 복잡한 계산을 통한 메모리 사용량 추정 (매우 근사치)
      const baseEstimate = (perfEntries.length + resourceEntries.length) * 0.1
      const frameEstimate = frameCount * 0.05
      const complexityEstimate = fpsHistoryRef.current.length * 0.02
      
      memoryUsage = Math.round((baseEstimate + frameEstimate + complexityEstimate) * 100) / 100
      
      if (process.env.NODE_ENV === 'development') {
        console.log('📊 Memory estimate (Firefox/Safari):', `${memoryUsage}MB (estimated)`)
      }
    }
    
    setMetrics(prev => ({
      ...prev,
      memoryUsage
    }))
  }, [enabled, devOnly])

  // 모니터링 시작
  const startMonitoring = useCallback(() => {
    // 활성화 상태를 런타임에 체크
    if (!enabled || (devOnly && process.env.NODE_ENV !== 'development') || isActiveRef.current) return

    setIsActive(true)
    isActiveRef.current = true
    lastTimeRef.current = performance.now()
    frameCountRef.current = 0
    jankCountRef.current = 0

    // FPS 측정 시작
    animationFrameRef.current = requestAnimationFrame(measureFrame)
    
    // FPS 업데이트 간격 설정
    fpsIntervalRef.current = setInterval(updateFPS, fpsUpdateInterval)
    
    // 메모리 업데이트 간격 설정
    memoryIntervalRef.current = setInterval(updateMemory, memoryUpdateInterval)

    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Performance monitoring started')
    }
  }, [enabled, devOnly, measureFrame, updateFPS, updateMemory, fpsUpdateInterval, memoryUpdateInterval])

  // 모니터링 중지
  const stopMonitoring = useCallback(() => {
    setIsActive(false)
    isActiveRef.current = false

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current)
      fpsIntervalRef.current = undefined
    }
    
    if (memoryIntervalRef.current) {
      clearInterval(memoryIntervalRef.current)
      memoryIntervalRef.current = undefined
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Performance monitoring stopped')
    }
  }, [])

  // 성능 데이터 리셋
  const resetMetrics = useCallback(() => {
    setMetrics({
      fps: 0,
      avgFps: 0,
      memoryUsage: 0,
      jankCount: 0,
      frameTime: 0,
      isLowPerformance: false
    })
    setHistory([])
    fpsHistoryRef.current = []
    frameCountRef.current = 0
    jankCountRef.current = 0
  }, [])

  // 컴포넌트 마운트 시 자동 시작
  useEffect(() => {
    if (enabled && (!devOnly || process.env.NODE_ENV === 'development')) {
      startMonitoring()
    }

    return () => {
      stopMonitoring()
    }
  }, [enabled, devOnly, startMonitoring, stopMonitoring])

  // 성능 보고서 생성 (에러 추적과 연동)
  const generateReport = useCallback(() => {
    // 에러 추적 시스템에서 에러 데이터 가져오기
    let errorData = null
    if (typeof window !== 'undefined' && (window as any).__ERROR_TRACKER__) {
      const errorTracker = (window as any).__ERROR_TRACKER__
      errorData = errorTracker.getMetrics()
    }

    const report = {
      summary: {
        averageFps: metrics.avgFps,
        peakFps: Math.max(...fpsHistoryRef.current),
        minFps: Math.min(...fpsHistoryRef.current),
        averageFrameTime: metrics.frameTime,
        totalJanks: metrics.jankCount,
        memoryUsage: metrics.memoryUsage,
        isLowPerformance: metrics.isLowPerformance,
        errorCount: errorData?.totalErrors || 0,
        criticalErrors: errorData?.criticalErrors || 0
      },
      history: history.slice(),
      errors: errorData,
      recommendations: [] as string[]
    }

    // 성능 개선 권장사항 생성
    if (report.summary.averageFps < 30) {
      report.recommendations.push('FPS가 낮습니다. 파티클 수를 줄이거나 GPU 가속을 확인하세요.')
    }
    
    if (report.summary.totalJanks > 10) {
      report.recommendations.push('Jank가 많이 발생하고 있습니다. 애니메이션 최적화를 고려하세요.')
    }
    
    if (report.summary.memoryUsage > 100) {
      report.recommendations.push('메모리 사용량이 높습니다. 메모리 누수를 확인하세요.')
    }

    if (report.summary.errorCount > 5) {
      report.recommendations.push(`${report.summary.errorCount}개의 에러가 발생했습니다. 안정성 개선이 필요합니다.`)
    }

    if (report.summary.criticalErrors > 0) {
      report.recommendations.push(`${report.summary.criticalErrors}개의 치명적 에러가 감지되었습니다. 즉시 수정이 필요합니다.`)
    }

    return report
  }, [metrics, history])

  return {
    metrics,
    history,
    isActive,
    startMonitoring,
    stopMonitoring,
    resetMetrics,
    generateReport
  }
}

/**
 * 특정 컴포넌트의 렌더링 성능 측정 훅
 */
export const useRenderPerformance = (componentName: string) => {
  const renderCountRef = useRef(0)
  const lastRenderTimeRef = useRef(0)
  const renderTimesRef = useRef<number[]>([])

  useEffect(() => {
    const renderStart = performance.now()
    const currentRenderCount = ++renderCountRef.current

    return () => {
      const renderEnd = performance.now()
      const renderTime = renderEnd - renderStart
      const renderTimes = renderTimesRef.current
      
      renderTimes.push(renderTime)
      if (renderTimes.length > 100) {
        renderTimes.shift()
      }

      // 렌더 시간 임계값을 500ms로 증가하여 노이즈 대폭 감소 (개발 중에만)
      if (process.env.NODE_ENV === 'development' && renderTime > 500) {
        // debounce 로직 추가 - 1초 내 중복 경고 방지
        const now = Date.now()
        const lastWarningKey = `slow-render-${componentName}`
        const lastWarning = (globalThis as any)[lastWarningKey] || 0
        
        if (now - lastWarning > 1000) {
          console.warn(`🐌 Slow render detected in ${componentName}:`, {
            renderTime: `${renderTime.toFixed(2)}ms`,
            renderCount: currentRenderCount,
            avgRenderTime: `${(renderTimes.reduce((sum, t) => sum + t, 0) / renderTimes.length).toFixed(2)}ms`
          });
          (globalThis as any)[lastWarningKey] = now
        }
      }

      lastRenderTimeRef.current = renderTime
    }
  })

  return {
    renderCount: renderCountRef.current,
    lastRenderTime: lastRenderTimeRef.current,
    avgRenderTime: renderTimesRef.current.length > 0 
      ? renderTimesRef.current.reduce((sum, t) => sum + t, 0) / renderTimesRef.current.length 
      : 0
  }
}

export default usePerformanceMonitor