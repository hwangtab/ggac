'use client'

export interface BrowserInfo {
  name: string
  version: number
  isMobile: boolean
  supportsWebP: boolean
  supportsAvif: boolean
  performanceModifier: number
}

/**
 * 브라우저별 성능 최적화를 위한 유틸리티 함수들
 */

/**
 * 현재 브라우저 정보를 감지하고 성능 프로파일을 반환
 */
export const getBrowserInfo = (): BrowserInfo => {
  if (typeof window === 'undefined') {
    return {
      name: 'unknown',
      version: 0,
      isMobile: false,
      supportsWebP: false,
      supportsAvif: false,
      performanceModifier: 0.6
    }
  }

  const userAgent = navigator.userAgent
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
  
  let browserName = 'unknown'
  let version = 0
  let performanceModifier = 1.0

  // Safari 감지
  if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
    browserName = 'safari'
    const match = userAgent.match(/Version\/(\d+)/)
    version = match ? parseInt(match[1]) : 0
    performanceModifier = 0.7 // Safari는 일반적으로 30% 느림
  }
  // Firefox 감지
  else if (/Firefox/.test(userAgent)) {
    browserName = 'firefox'
    const match = userAgent.match(/Firefox\/(\d+)/)
    version = match ? parseInt(match[1]) : 0
    performanceModifier = 0.8 // Firefox는 20% 느림
  }
  // Chrome/Chromium 계열
  else if (/Chrome/.test(userAgent)) {
    browserName = 'chrome'
    const match = userAgent.match(/Chrome\/(\d+)/)
    version = match ? parseInt(match[1]) : 0
    performanceModifier = 1.0 // 기준점
  }
  // Edge
  else if (/Edg/.test(userAgent)) {
    browserName = 'edge'
    const match = userAgent.match(/Edg\/(\d+)/)
    version = match ? parseInt(match[1]) : 0
    performanceModifier = 0.9
  }

  // 모바일 디바이스는 성능이 더 제한적
  if (isMobile) {
    performanceModifier *= 0.6
  }

  // 이미지 포맷 지원 감지
  const canvas = document.createElement('canvas')
  const supportsWebP = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
  
  // AVIF 지원은 더 정확한 감지 필요
  const supportsAvif = (() => {
    const avifImg = new Image()
    avifImg.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEAwgMg8f8D///8WfhwB8+ErK42A='
    return avifImg.complete && avifImg.width > 0
  })()

  return {
    name: browserName,
    version,
    isMobile,
    supportsWebP,
    supportsAvif,
    performanceModifier
  }
}

/**
 * 브라우저별 최적화된 파티클 수를 계산
 */
export const getOptimizedParticleCount = (
  baseCount: number, 
  browserInfo: BrowserInfo
): number => {
  let optimizedCount = Math.floor(baseCount * browserInfo.performanceModifier)
  
  // 브라우저별 세부 조정
  switch (browserInfo.name) {
    case 'safari':
      // Safari iOS에서 추가 감소
      if (browserInfo.isMobile) {
        optimizedCount = Math.floor(optimizedCount * 0.5)
      }
      break
    
    case 'firefox':
      // Firefox에서 약간 감소
      optimizedCount = Math.floor(optimizedCount * 0.9)
      break
    
    case 'edge':
      // Edge Legacy 지원
      if (browserInfo.version < 80) {
        optimizedCount = Math.floor(optimizedCount * 0.7)
      }
      break
  }
  
  // 최소/최대 제한
  return Math.max(10, Math.min(optimizedCount, 300))
}

/**
 * 브라우저별 애니메이션 지속시간 최적화
 */
export const getOptimizedAnimationDuration = (
  baseDuration: number, 
  browserInfo: BrowserInfo
): number => {
  let duration = baseDuration
  
  // Safari에서는 애니메이션을 더 느리게
  if (browserInfo.name === 'safari') {
    duration *= 1.2
  }
  
  // 모바일에서는 애니메이션을 더 빠르게 (배터리 절약)
  if (browserInfo.isMobile) {
    duration *= 0.8
  }
  
  return duration
}

/**
 * 브라우저별 최적화된 이미지 포맷 선택
 */
export const getOptimizedImageSrc = (
  originalSrc: string, 
  browserInfo: BrowserInfo
): string => {
  if (!originalSrc.startsWith('/') || !originalSrc.match(/\.(jpe?g|png)$/i)) {
    return originalSrc
  }
  
  // AVIF 지원 (Chrome/Firefox 최신 버전)
  if (browserInfo.supportsAvif && browserInfo.name !== 'safari') {
    return originalSrc.replace(/\.(jpe?g|png)$/i, '.avif')
  }
  
  // WebP 지원 (Safari 14+, Firefox, Chrome)
  if (browserInfo.supportsWebP) {
    // Safari < 14는 WebP 미지원
    if (browserInfo.name === 'safari' && browserInfo.version < 14) {
      return originalSrc
    }
    return originalSrc.replace(/\.(jpe?g|png)$/i, '.webp')
  }
  
  return originalSrc
}

/**
 * 브라우저별 WebGL 최적화 옵션
 */
export const getWebGLContextOptions = (browserInfo: BrowserInfo): WebGLContextAttributes => {
  const baseOptions: WebGLContextAttributes = {
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  }
  
  // Safari 최적화
  if (browserInfo.name === 'safari') {
    return {
      ...baseOptions,
      failIfMajorPerformanceCaveat: true, // 성능이 떨어지면 실패
      antialias: false // Safari에서 안티앨리어싱 끄기
    }
  }
  
  // Firefox 최적화
  if (browserInfo.name === 'firefox') {
    return {
      ...baseOptions,
      antialias: false // Firefox WebGL 성능 향상
    }
  }
  
  return baseOptions
}

/**
 * 브라우저별 CSS 최적화 클래스 생성
 */
export const getBrowserOptimizedClasses = (browserInfo: BrowserInfo): string => {
  const classes: string[] = []
  
  if (browserInfo.name === 'safari') {
    classes.push('browser-safari')
    if (browserInfo.isMobile) {
      classes.push('browser-safari-mobile')
    }
  }
  
  if (browserInfo.name === 'firefox') {
    classes.push('browser-firefox')
  }
  
  if (browserInfo.isMobile) {
    classes.push('browser-mobile')
  }
  
  return classes.join(' ')
}

/**
 * 브라우저 감지 결과를 세션에 캐시
 */
export const getCachedBrowserInfo = (): BrowserInfo => {
  if (typeof window === 'undefined') {
    return getBrowserInfo()
  }
  
  const cached = sessionStorage.getItem('browser-info')
  
  if (cached) {
    try {
      return JSON.parse(cached)
    } catch (e) {
      // 캐시 파싱 실패시 새로 감지
    }
  }
  
  const browserInfo = getBrowserInfo()
  sessionStorage.setItem('browser-info', JSON.stringify(browserInfo))
  
  return browserInfo
}