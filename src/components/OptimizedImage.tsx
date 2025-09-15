'use client'

import Image from 'next/image'
import { useState, useEffect, useMemo, useRef, memo } from 'react'
import type { OptimizedImageProps } from '@/types'

const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  fill = false,
  sizes,
  quality = 80, // 품질과 성능의 최적 균형
  fallbackText,
  // preferWebp 제거: Next.js가 자동으로 AVIF/WebP 선택
  preserveAspectRatio = false,
  onLoadStart,
  onLoad: onLoadProp,
  onError: onErrorProp,
  suppressSkeleton = false, // 외부 스켈레톤 사용 시 내부 스켈레톤 비활성화
  unoptimized = false, // 특정 도메인 등에서 최적화 우회
  loadTimeoutMs = 8000, // 최적화 파이프라인 타임아웃 후 우회
  errorTimeoutMs = 5000, // 우회 후에도 응답 없을 때 에러 처리까지 대기
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [useUnoptimized, setUseUnoptimized] = useState<boolean>(false)

  // 최적화 우회 대상 도메인 목록 (간헐적 응답 지연/차단 이슈 대응)
  const UNOPTIMIZED_HOSTS = useMemo(() => new Set(['www.news-art.co.kr', 'news-art.co.kr']), [])

  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef<boolean>(true)

  // src 기준으로 호스트 파싱 (상대 경로는 무시)
  const srcHost = useMemo(() => {
    try {
      const u = new URL(src)
      return u.hostname
    } catch {
      return ''
    }
  }, [src])

  // 이미지 상태 초기화 - Next.js가 모든 최적화 처리
  useEffect(() => {
    // 초기화
    setHasError(false)
    setIsLoading(true)
    loadingRef.current = true
    setCurrentSrc(src)
    setUseUnoptimized(unoptimized || (srcHost ? UNOPTIMIZED_HOSTS.has(srcHost) : false))
    onLoadStart?.() // 외부 로딩 시작 알림

    // 타임아웃 기반 우회: 지정 시간 내 로드 이벤트가 없으면 unoptimized로 스위칭
    if (activeTimer.current) {
      clearTimeout(activeTimer.current)
      activeTimer.current = null
    }
    activeTimer.current = setTimeout(() => {
      if (loadingRef.current) {
        // 1차: 최적화 우회 시도
        setUseUnoptimized(true)
        // 2차: 우회 후에도 응답 없으면 에러 처리
        if (activeTimer.current) clearTimeout(activeTimer.current)
        activeTimer.current = setTimeout(() => {
          if (loadingRef.current) {
            setHasError(true)
            setIsLoading(false)
            loadingRef.current = false
            onErrorProp?.()
          }
        }, errorTimeoutMs)
      }
    }, loadTimeoutMs)

    return () => {
      if (activeTimer.current) {
        clearTimeout(activeTimer.current)
        activeTimer.current = null
      }
    }
  }, [src, srcHost, UNOPTIMIZED_HOSTS, unoptimized, onLoadStart, loadTimeoutMs, errorTimeoutMs])

  const handleError = () => {
    // 최적화된 이미지 폴백 체인: WebP → JPG → PNG (JPEG 단계 제거로 속도 향상)

    // 1단계: WebP → JPG 시도 (가장 일반적인 형식)
    if (currentSrc.endsWith('.webp')) {
      const jpgSrc = currentSrc.replace('.webp', '.jpg')
      setCurrentSrc(jpgSrc)
      setIsLoading(true)
      return
    }

    // 2단계: JPG → PNG 시도 (최종 폴백)
    if (currentSrc.endsWith('.jpg')) {
      const pngSrc = currentSrc.replace('.jpg', '.png')
      setCurrentSrc(pngSrc)
      setIsLoading(true)
      return
    }

    // 최종 실패 시에만 fallbackText 표시
    setHasError(true)
    setIsLoading(false)
    loadingRef.current = false
    onErrorProp?.() // 외부 에러 핸들러 호출
  }

  const handleLoad = () => {
    setIsLoading(false)
    loadingRef.current = false
    if (activeTimer.current) {
      clearTimeout(activeTimer.current)
      activeTimer.current = null
    }
    onLoadProp?.() // 외부 로딩 완료 핸들러 호출
  }

  if (hasError) {
    return (
      <div
        className={`bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center ${className}`}
      >
        <span className="text-primary-600 font-medium text-center px-4 text-2xl font-sans">
          {fallbackText || alt.slice(0, 3)}
        </span>
      </div>
    )
  }

  const imageProps = {
    src: currentSrc,
    alt,
    quality,
    priority,
    onError: handleError,
    onLoad: handleLoad,
    className,
    unoptimized: useUnoptimized,
    // Next.js가 자동으로 WebP/AVIF 변환하므로 placeholder는 기본값 사용
    placeholder: 'blur' as const,
    blurDataURL:
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R//2Q==',
    ...(fill
      ? {
          fill: true,
          // 더 세밀한 sizes 속성으로 대역폭 최적화
          sizes:
            sizes ||
            '(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw',
        }
      : {
          width: width || 800,
          height: height || 600,
          sizes:
            sizes ||
            '(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw',
        }),
  }

  // Progressive loading with loading indicator
  return (
    <div className={fill ? `relative ${className}` : className}>
      {/* 외부에서 스켈레톤을 제공하지 않을 때만 내부 스켈레톤 표시 */}
      {isLoading && !suppressSkeleton && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      )}
      <Image
        {...imageProps}
        alt={alt || ''}
        className={`transition-opacity duration-500 ${
          suppressSkeleton ? '' : isLoading ? 'opacity-0' : 'opacity-100'
        } ${fill ? '' : className}`}
      />
    </div>
  )
})

export default OptimizedImage
