'use client'

import { useState, useEffect } from 'react'
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor'

interface PerformanceMonitorProps {
  // 모니터 위치
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  // 표시 모드
  mode?: 'compact' | 'detailed' | 'minimal'
  // 자동 숨김
  autoHide?: boolean
  // 저성능 시에만 표시
  showOnlyWhenLowPerf?: boolean
  // 개발 환경에서만 표시
  devOnly?: boolean
}

const PerformanceMonitor = ({
  position = 'top-right',
  mode = 'compact',
  autoHide = false,
  showOnlyWhenLowPerf = false,
  devOnly = true,
}: PerformanceMonitorProps) => {
  const [isVisible, setIsVisible] = useState(!autoHide)
  const [isExpanded, setIsExpanded] = useState(false)
  const { metrics, history, isActive, generateReport } = usePerformanceMonitor({
    enabled: true,
    devOnly,
  })

  // 자동 숨김 로직
  useEffect(() => {
    if (!autoHide || !metrics.isLowPerformance) return

    setIsVisible(true)
    const timer = setTimeout(() => setIsVisible(false), 5000)
    return () => clearTimeout(timer)
  }, [autoHide, metrics.isLowPerformance])

  // 개발 환경 확인
  const isDev = process.env.NODE_ENV === 'development'
  if (devOnly && !isDev) return null

  // 저성능 시에만 표시하는 옵션
  if (showOnlyWhenLowPerf && !metrics.isLowPerformance) return null

  // 위치 스타일
  const getPositionStyles = () => {
    const baseStyles = 'fixed z-[9999] pointer-events-auto'
    switch (position) {
      case 'top-left':
        return `${baseStyles} top-4 left-4`
      case 'top-right':
        return `${baseStyles} top-4 right-4`
      case 'bottom-left':
        return `${baseStyles} bottom-4 left-4`
      case 'bottom-right':
        return `${baseStyles} bottom-4 right-4`
      default:
        return `${baseStyles} top-4 right-4`
    }
  }

  // 성능 상태에 따른 색상
  const getStatusColor = () => {
    if (metrics.fps >= 50) return 'text-green-400'
    if (metrics.fps >= 30) return 'text-yellow-400'
    return 'text-red-400'
  }

  // 메모리 사용량 색상
  const getMemoryColor = () => {
    if (metrics.memoryUsage < 50) return 'text-green-400'
    if (metrics.memoryUsage < 100) return 'text-yellow-400'
    return 'text-red-400'
  }

  // 보고서 다운로드
  const downloadReport = () => {
    const report = generateReport()
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `performance-report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed top-4 right-4 z-[9999] w-3 h-3 bg-white/20 hover:bg-white/40 rounded-full transition-colors duration-200"
        title="성능 모니터 표시"
      />
    )
  }

  // 미니멀 모드
  if (mode === 'minimal') {
    return (
      <div className={getPositionStyles()}>
        <div
          className="bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[120px] cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between text-xs font-mono">
            <span className={`${getStatusColor()} font-bold`}>{metrics.fps}fps</span>
            <button
              onClick={e => {
                e.stopPropagation()
                setIsVisible(false)
              }}
              className="text-white/50 hover:text-white/80 ml-2"
            >
              ×
            </button>
          </div>

          {isExpanded && (
            <div className="mt-2 pt-2 border-t border-white/20 text-xs text-white/70">
              <div>평균: {metrics.avgFps}fps</div>
              <div className={getMemoryColor()}>메모리: {metrics.memoryUsage}MB</div>
              {metrics.jankCount > 0 && (
                <div className="text-red-400">Jank: {metrics.jankCount}</div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 컴팩트 모드
  if (mode === 'compact') {
    return (
      <div className={getPositionStyles()}>
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 min-w-[200px]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white text-sm font-semibold">성능 모니터</h3>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400' : 'bg-red-400'}`} />
              <button
                onClick={() => setIsVisible(false)}
                className="text-white/50 hover:text-white/80"
              >
                ×
              </button>
            </div>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-white/70">FPS:</span>
              <span className={getStatusColor()}>{metrics.fps}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-white/70">평균:</span>
              <span className="text-white/90">{metrics.avgFps}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-white/70">프레임 시간:</span>
              <span className="text-white/90">{metrics.frameTime}ms</span>
            </div>

            <div className="flex justify-between">
              <span className="text-white/70">메모리:</span>
              <span className={getMemoryColor()}>{metrics.memoryUsage}MB</span>
            </div>

            {metrics.jankCount > 0 && (
              <div className="flex justify-between">
                <span className="text-white/70">Jank:</span>
                <span className="text-red-400">{metrics.jankCount}</span>
              </div>
            )}
          </div>

          {metrics.isLowPerformance && (
            <div className="mt-2 p-2 bg-red-500/20 rounded text-xs text-red-300">
              ⚠️ 저성능 감지됨
            </div>
          )}
        </div>
      </div>
    )
  }

  // 상세 모드
  return (
    <div className={getPositionStyles()}>
      <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 min-w-[280px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white text-base font-semibold">성능 모니터</h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400' : 'bg-red-400'}`} />
            <button
              onClick={() => setIsVisible(false)}
              className="text-white/50 hover:text-white/80"
            >
              ×
            </button>
          </div>
        </div>

        {/* 실시간 메트릭 */}
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded p-2">
              <div className="text-white/70 text-xs">FPS</div>
              <div className={`text-lg font-mono ${getStatusColor()}`}>{metrics.fps}</div>
            </div>

            <div className="bg-white/5 rounded p-2">
              <div className="text-white/70 text-xs">평균 FPS</div>
              <div className="text-lg font-mono text-white/90">{metrics.avgFps}</div>
            </div>

            <div className="bg-white/5 rounded p-2">
              <div className="text-white/70 text-xs">프레임 시간</div>
              <div className="text-lg font-mono text-white/90">{metrics.frameTime}ms</div>
            </div>

            <div className="bg-white/5 rounded p-2">
              <div className="text-white/70 text-xs">메모리</div>
              <div className={`text-lg font-mono ${getMemoryColor()}`}>{metrics.memoryUsage}MB</div>
            </div>
          </div>

          {metrics.jankCount > 0 && (
            <div className="bg-red-500/20 rounded p-2">
              <div className="text-red-300 text-xs">Jank 감지</div>
              <div className="text-red-400 font-mono">{metrics.jankCount}회</div>
            </div>
          )}
        </div>

        {/* 성능 히스토리 그래프 (간단한 시각화) */}
        {history.length > 10 && (
          <div className="mt-4">
            <div className="text-white/70 text-xs mb-2">FPS 히스토리</div>
            <div className="flex items-end h-12 gap-0.5">
              {history.slice(-30).map((point, index) => {
                const height = Math.max((point.fps / 60) * 100, 2)
                const color =
                  point.fps >= 50
                    ? 'bg-green-400'
                    : point.fps >= 30
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                return (
                  <div
                    key={index}
                    className={`${color} w-1 opacity-70`}
                    style={{ height: `${height}%` }}
                    title={`${point.fps}fps`}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* 액션 버튼들 */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={downloadReport}
            className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs py-1.5 rounded transition-colors"
          >
            보고서 다운로드
          </button>
        </div>

        {/* 성능 경고 */}
        {metrics.isLowPerformance && (
          <div className="mt-3 p-2 bg-red-500/20 rounded">
            <div className="text-red-300 text-xs font-semibold">⚠️ 성능 경고</div>
            <div className="text-red-200 text-xs mt-1">
              FPS가 낮습니다. 파티클 수를 줄이거나 다른 최적화를 고려하세요.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PerformanceMonitor
