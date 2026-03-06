/**
 * 번들 크기 최적화를 위한 유틸리티 함수들
 */

// 현재 번들 크기 및 성능 정보
export interface BundleStats {
  totalSize: number
  gzipSize: number
  loadTime: number
  renderTime: number
  memoryUsage: number
}

// 번들 크기 분석 정보
export interface BundleAnalysis {
  largestChunks: Array<{
    name: string
    size: number
    percentage: number
  }>
  duplicateModules: string[]
  unusedExports: string[]
  recommendations: string[]
}

/**
 * 런타임 번들 크기 측정
 */
export const measureBundleSize = (): BundleStats => {
  const performance = window.performance
  const memory = (performance as any).memory

  // 네트워크 리소스 크기 계산
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const totalSize = resources.reduce((sum, resource) => {
    return sum + (resource.transferSize || 0)
  }, 0)

  const gzipSize = resources.reduce((sum, resource) => {
    return sum + (resource.encodedBodySize || 0)
  }, 0)

  // 로딩 시간 계산
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
  const loadTime = navigation.loadEventEnd - navigation.fetchStart

  // 렌더링 시간 계산
  const renderTime = navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart

  // 메모리 사용량 (Chrome에서만 사용 가능)
  const memoryUsage = memory ? memory.usedJSHeapSize : 0

  return {
    totalSize,
    gzipSize,
    loadTime,
    renderTime,
    memoryUsage,
  }
}

/**
 * 동적 임포트 최적화
 */
export const optimizedImport = <T>(
  importFunc: () => Promise<T>,
  fallback?: () => T,
  timeout: number = 10000
): Promise<T> => {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Dynamic import timeout'))
    }, timeout)
  })

  return Promise.race([importFunc(), timeoutPromise]).catch(error => {
    console.warn('Dynamic import failed:', error)
    if (fallback) {
      return fallback()
    }
    throw error
  })
}

/**
 * 지연 로딩 최적화
 */
export const createLazyComponent = <T extends any>(
  importFunc: () => Promise<{ default: T }>,
  preload: boolean = false
) => {
  // React.lazy를 동적으로 import하여 사용
  const React = typeof window !== 'undefined' ? require('react') : null
  if (!React) return null

  const LazyComponent = React.lazy(importFunc)

  // 프리로드 옵션이 활성화된 경우 즉시 프리로드
  if (preload && typeof window !== 'undefined') {
    // 사용자 상호작용이 없을 때 프리로드
    const preloadComponent = () => {
      requestIdleCallback(() => {
        importFunc().catch(console.warn)
      })
    }

    // 페이지 로드 후 프리로드
    if (document.readyState === 'complete') {
      preloadComponent()
    } else {
      window.addEventListener('load', preloadComponent, { once: true })
    }
  }

  return LazyComponent
}

/**
 * 번들 크기 모니터링
 */
export const monitorBundleSize = () => {
  if (typeof window === 'undefined') return

  const stats = measureBundleSize()

  // 개발 환경에서만 로그 출력
  if (process.env.NODE_ENV === 'development') {
    console.group('Bundle Size Analysis')
    console.log('Total Size:', formatBytes(stats.totalSize))
    console.log('Gzip Size:', formatBytes(stats.gzipSize))
    console.log('Load Time:', stats.loadTime.toFixed(2) + 'ms')
    console.log('Render Time:', stats.renderTime.toFixed(2) + 'ms')
    if (stats.memoryUsage > 0) {
      console.log('Memory Usage:', formatBytes(stats.memoryUsage))
    }
    console.groupEnd()
  }

  // 성능 임계값 체크
  const warnings = []
  if (stats.totalSize > 1024 * 1024) {
    // 1MB 초과
    warnings.push('Bundle size is larger than 1MB')
  }
  if (stats.loadTime > 3000) {
    // 3초 초과
    warnings.push('Load time is longer than 3 seconds')
  }
  if (stats.memoryUsage > 50 * 1024 * 1024) {
    // 50MB 초과
    warnings.push('Memory usage is higher than 50MB')
  }

  if (warnings.length > 0) {
    console.warn('Bundle Performance Warnings:', warnings)
  }

  return stats
}

/**
 * 바이트 단위 포맷팅
 */
export const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * 중복 모듈 검사
 */
export const findDuplicateModules = (): string[] => {
  if (typeof window === 'undefined') return []

  const modules = new Set<string>()
  const duplicates: string[] = []

  // 로드된 스크립트 태그 분석
  const scripts = document.querySelectorAll('script[src]')
  scripts.forEach(script => {
    const src = script.getAttribute('src')
    if (src) {
      // 청크 파일명에서 모듈명 추출
      const match = src.match(/([^\/]+)\.js$/)
      if (match) {
        const moduleName = match[1]
        if (modules.has(moduleName)) {
          duplicates.push(moduleName)
        } else {
          modules.add(moduleName)
        }
      }
    }
  })

  return duplicates
}

/**
 * 코드 스플리팅 권장사항
 */
export const getBundleRecommendations = (stats: BundleStats): string[] => {
  const recommendations: string[] = []

  if (stats.totalSize > 500 * 1024) {
    recommendations.push('Consider implementing route-based code splitting')
  }

  if (stats.loadTime > 2000) {
    recommendations.push('Optimize bundle loading with lazy loading')
  }

  if (stats.memoryUsage > 30 * 1024 * 1024) {
    recommendations.push('Consider reducing bundle size or implementing memory optimization')
  }

  const duplicates = findDuplicateModules()
  if (duplicates.length > 0) {
    recommendations.push(`Remove duplicate modules: ${duplicates.join(', ')}`)
  }

  return recommendations
}

/**
 * 번들 성능 리포트 생성
 */
export const generateBundleReport = (): BundleAnalysis => {
  const stats = measureBundleSize()
  const duplicates = findDuplicateModules()
  const recommendations = getBundleRecommendations(stats)

  // 리소스 크기별 정렬
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const largestChunks = resources
    .filter(resource => resource.name.includes('.js'))
    .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
    .slice(0, 10)
    .map(resource => ({
      name: resource.name.split('/').pop() || 'unknown',
      size: resource.transferSize || 0,
      percentage: ((resource.transferSize || 0) / stats.totalSize) * 100,
    }))

  return {
    largestChunks,
    duplicateModules: duplicates,
    unusedExports: [], // 런타임에서는 감지 어려움
    recommendations,
  }
}

// Simple bundle monitoring utility (without React dependency)
export const startBundleMonitoring = () => {
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      monitorBundleSize()
    }, 1000)
  }
}

const bundleOptimization = {
  measureBundleSize,
  optimizedImport,
  createLazyComponent,
  monitorBundleSize,
  formatBytes,
  findDuplicateModules,
  getBundleRecommendations,
  generateBundleReport,
  startBundleMonitoring,
}

export default bundleOptimization
