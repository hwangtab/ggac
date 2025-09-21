'use client'

import Image from 'next/image'
import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
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
  loadTimeoutMs = 3000, // 최적화 파이프라인 타임아웃 후 우회 (로컬 이미지용 단축)
  errorTimeoutMs = 2000, // 우회 후에도 응답 없을 때 에러 처리까지 대기
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [useUnoptimized, setUseUnoptimized] = useState<boolean>(false)

  // 최적화 우회 대상 도메인 목록 (간헐적 응답 지연/차단 이슈 대응)
  const UNOPTIMIZED_HOSTS = useMemo(() => new Set(['www.news-art.co.kr', 'news-art.co.kr']), [])

  // Supabase Storage URL 패턴 감지
  const SUPABASE_STORAGE_PATTERN = useMemo(
    () => /\.supabase\.co\/storage\/v1\/object\/public\//i,
    []
  )

  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef<boolean>(true)
  const fallbackQueueRef = useRef<string[]>([])

  const buildFallbackQueue = useCallback((input: string): string[] => {
    if (!input) return []

    try {
      // 쿼리스트링 분리
      const [pathPart, queryPart] = input.split('?', 2)
      const extensionMatch = pathPart.match(/\.([a-zA-Z0-9]+)$/)
      if (!extensionMatch) return []

      const ext = extensionMatch[1].toLowerCase()
      const basePath = pathPart.slice(0, -ext.length - 1)
      const querySuffix = queryPart ? `?${queryPart}` : ''

      const preferredOrder = ['webp', 'jpg', 'jpeg', 'png']
      const queue: string[] = []

      for (const candidateExt of preferredOrder) {
        if (candidateExt === ext) continue
        queue.push(`${basePath}.${candidateExt}${querySuffix}`)
      }

      return queue
    } catch {
      return []
    }
  }, [])

  // src 기준으로 호스트 파싱 및 URL 타입 결정
  const { srcHost, isSupabaseStorage, isExternalUrl } = useMemo(() => {
    try {
      const u = new URL(src)
      const hostname = u.hostname
      const isSupabase = SUPABASE_STORAGE_PATTERN.test(src)
      const isExternal = Boolean(hostname)
      return {
        srcHost: hostname,
        isSupabaseStorage: isSupabase,
        isExternalUrl: isExternal,
      }
    } catch {
      return {
        srcHost: '',
        isSupabaseStorage: false,
        isExternalUrl: false,
      }
    }
  }, [src, SUPABASE_STORAGE_PATTERN])

  // 이미지 상태 초기화 - URL 타입별 최적화 전략 적용
  useEffect(() => {
    // 초기화
    setHasError(false)
    setIsLoading(true)
    loadingRef.current = true
    setCurrentSrc(src)
    fallbackQueueRef.current = buildFallbackQueue(src)

    // URL 타입별 최적화 설정
    const shouldUseUnoptimized =
      unoptimized || (srcHost ? UNOPTIMIZED_HOSTS.has(srcHost) : false) || isSupabaseStorage // Supabase Storage는 항상 unoptimized 사용

    setUseUnoptimized(shouldUseUnoptimized)
    onLoadStart?.()

    // Supabase Storage 이미지의 경우 더 짧은 타임아웃 적용
    const currentLoadTimeout = isSupabaseStorage ? 4000 : loadTimeoutMs
    const currentErrorTimeout = isSupabaseStorage ? 2000 : errorTimeoutMs

    // 타임아웃 기반 우회
    if (activeTimer.current) {
      clearTimeout(activeTimer.current)
      activeTimer.current = null
    }

    activeTimer.current = setTimeout(() => {
      if (loadingRef.current) {
        // Supabase/외부 URL의 경우 즉시 에러 처리
        if (isSupabaseStorage || isExternalUrl) {
          setHasError(true)
          setIsLoading(false)
          loadingRef.current = false
          onErrorProp?.()
          return
        }

        // 로컬 이미지의 경우 기존 로직 적용
        setUseUnoptimized(true)
        if (activeTimer.current) clearTimeout(activeTimer.current)
        activeTimer.current = setTimeout(() => {
          if (loadingRef.current) {
            setHasError(true)
            setIsLoading(false)
            loadingRef.current = false
            onErrorProp?.()
          }
        }, currentErrorTimeout)
      }
    }, currentLoadTimeout)

    return () => {
      if (activeTimer.current) {
        clearTimeout(activeTimer.current)
        activeTimer.current = null
      }
    }
  }, [
    src,
    srcHost,
    UNOPTIMIZED_HOSTS,
    unoptimized,
    onLoadStart,
    loadTimeoutMs,
    errorTimeoutMs,
    isSupabaseStorage,
    isExternalUrl,
  ])

  const handleError = () => {
    // Supabase Storage URL의 경우 폴백 시도 없이 바로 에러 처리
    if (isSupabaseStorage) {
      console.warn(`[OptimizedImage] Supabase Storage 이미지 로딩 실패: ${currentSrc}`)
      setHasError(true)
      setIsLoading(false)
      loadingRef.current = false
      onErrorProp?.()
      return
    }

    // 기타 외부 URL의 경우도 폴백 시도 없이 바로 에러 처리
    if (isExternalUrl) {
      console.warn(`[OptimizedImage] 외부 이미지 로딩 실패: ${currentSrc}`)
      setHasError(true)
      setIsLoading(false)
      loadingRef.current = false
      onErrorProp?.()
      return
    }

    // 로컬 이미지 폴백 큐에서 다음 후보 선택
    const nextFallback = fallbackQueueRef.current.shift()
    if (nextFallback) {
      setCurrentSrc(nextFallback)
      setIsLoading(true)
      return
    }

    // 최종 실패 시에만 fallbackText 표시
    console.warn(`[OptimizedImage] 로컬 이미지 폴백 실패: ${currentSrc}`)
    setHasError(true)
    setIsLoading(false)
    loadingRef.current = false
    onErrorProp?.()
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
