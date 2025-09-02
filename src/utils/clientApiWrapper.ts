/**
 * 클라이언트 사이드 API 호출 공통 래퍼 함수
 * 
 * 프론트엔드에서 API를 호출할 때 사용하는 통합된 래퍼입니다.
 * - 자동 에러 처리
 * - 로딩 상태 통합
 * - 타입 안전성
 * - 재시도 로직
 * - 요청/응답 로깅
 */

import { ApiResponse, ApiSuccessResponse, ApiErrorResponse } from '@/utils/apiWrapper'

// 클라이언트 API 설정
export interface ClientApiConfig {
  /** 기본 베이스 URL */
  baseUrl?: string
  /** 기본 타임아웃 (밀리초) */
  timeout?: number
  /** 자동 재시도 횟수 */
  retryAttempts?: number
  /** 재시도 지연 시간 (밀리초) */
  retryDelay?: number
  /** 전역 헤더 */
  defaultHeaders?: Record<string, string>
  /** 디버그 모드 */
  debug?: boolean
}

// 개별 요청 옵션
export interface RequestOptions extends RequestInit {
  /** 타임아웃 (밀리초) */
  timeout?: number
  /** 재시도 횟수 */
  retryAttempts?: number
  /** 재시도 지연 시간 (밀리초) */
  retryDelay?: number
  /** 로딩 상태 키 */
  loadingKey?: string
  /** 에러 자동 표시 비활성화 */
  skipErrorDisplay?: boolean
  /** 성공 메시지 자동 표시 */
  showSuccessMessage?: boolean
  /** 캐시 사용 여부 */
  useCache?: boolean
  /** 캐시 키 */
  cacheKey?: string
  /** 캐시 TTL (밀리초) */
  cacheTTL?: number
}

// API 에러 클래스
export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: ApiErrorResponse,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'ClientApiError'
  }
}

// 전역 설정
let globalConfig: ClientApiConfig = {
  baseUrl: '',
  timeout: 30000,
  retryAttempts: 2,
  retryDelay: 1000,
  defaultHeaders: {
    'Content-Type': 'application/json'
  },
  debug: process.env.NODE_ENV === 'development'
}

// 간단한 메모리 캐시
const apiCache = new Map<string, { data: any; timestamp: number; ttl: number }>()

/**
 * 전역 API 설정
 */
export function configureClientApi(config: Partial<ClientApiConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * 캐시에서 데이터 가져오기
 */
function getCachedData<T>(key: string): T | null {
  const cached = apiCache.get(key)
  if (!cached) return null

  const now = Date.now()
  if (now - cached.timestamp > cached.ttl) {
    apiCache.delete(key)
    return null
  }

  return cached.data
}

/**
 * 데이터 캐시에 저장
 */
function setCachedData<T>(key: string, data: T, ttl: number): void {
  apiCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  })
}

/**
 * 지연 함수
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * URL 파라미터 직렬화
 */
function serializeParams(params: Record<string, any>): string {
  const urlParams = new URLSearchParams()
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach(item => urlParams.append(key, String(item)))
      } else {
        urlParams.append(key, String(value))
      }
    }
  })
  
  return urlParams.toString()
}

/**
 * 핵심 API 호출 함수
 */
async function executeRequest<T = any>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  const {
    timeout = globalConfig.timeout,
    retryAttempts = globalConfig.retryAttempts,
    retryDelay = globalConfig.retryDelay,
    useCache = false,
    cacheKey,
    cacheTTL = 300000, // 5분
    skipErrorDisplay = false,
    showSuccessMessage = false,
    ...fetchOptions
  } = options

  const fullUrl = url.startsWith('http') ? url : `${globalConfig.baseUrl}${url}`
  const finalCacheKey = cacheKey || `${fetchOptions.method || 'GET'}:${fullUrl}`

  // 캐시 확인 (GET 요청만)
  if (useCache && (!fetchOptions.method || fetchOptions.method === 'GET')) {
    const cachedData = getCachedData<ApiSuccessResponse<T>>(finalCacheKey)
    if (cachedData) {
      if (globalConfig.debug) {
        console.log(`[CLIENT API] Cache hit for ${fullUrl}`)
      }
      return cachedData
    }
  }

  const headers = {
    ...globalConfig.defaultHeaders,
    ...fetchOptions.headers
  }

  let lastError: Error | null = null
  let attempt = 0

  while (attempt <= (retryAttempts || 0)) {
    try {
      if (globalConfig.debug) {
        console.log(`[CLIENT API] ${fetchOptions.method || 'GET'} ${fullUrl} (attempt ${attempt + 1})`)
      }

      // 타임아웃 설정
      const controller = new AbortController()
      const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null

      const response = await fetch(fullUrl, {
        ...fetchOptions,
        headers,
        signal: controller.signal
      })

      if (timeoutId) clearTimeout(timeoutId)

      let responseData: ApiResponse<T>

      try {
        responseData = await response.json()
      } catch (parseError) {
        // JSON 파싱 실패 시 텍스트로 처리
        const textData = await response.text()
        throw new ClientApiError(
          `응답 파싱 실패: ${textData}`,
          response.status,
          undefined,
          parseError as Error
        )
      }

      if (!response.ok) {
        const errorResponse = responseData as ApiErrorResponse
        const errorMessage = errorResponse.error || `HTTP ${response.status}: ${response.statusText}`
        
        if (globalConfig.debug) {
          console.error(`[CLIENT API] Error ${response.status}:`, errorResponse)
        }

        throw new ClientApiError(errorMessage, response.status, errorResponse)
      }

      const successResponse = responseData as ApiSuccessResponse<T>

      // 성공 응답 캐싱
      if (useCache && (!fetchOptions.method || fetchOptions.method === 'GET')) {
        setCachedData(finalCacheKey, successResponse, cacheTTL)
      }

      // 성공 메시지 표시
      if (showSuccessMessage && successResponse.message) {
        // 향후 토스트나 알림 시스템과 통합 예정
        console.log(`[SUCCESS] ${successResponse.message}`)
      }

      if (globalConfig.debug) {
        console.log(`[CLIENT API] Success:`, successResponse)
      }

      return successResponse

    } catch (error) {
      lastError = error as Error
      
      if (error instanceof ClientApiError) {
        // 재시도 불가능한 에러들
        if (error.status === 401 || error.status === 403 || error.status === 404) {
          throw error
        }
      }

      attempt++
      
      if (attempt <= (retryAttempts || 0)) {
        if (globalConfig.debug) {
          console.log(`[CLIENT API] Retrying in ${retryDelay}ms...`)
        }
        await delay(retryDelay || 1000)
      }
    }
  }

  // 모든 재시도 실패
  if (!skipErrorDisplay && lastError) {
    // 향후 에러 토스트나 알림 시스템과 통합 예정
    console.error(`[CLIENT API] Final error:`, lastError)
  }

  throw lastError || new ClientApiError('알 수 없는 오류가 발생했습니다.', 500)
}

/**
 * HTTP 메서드별 래퍼 함수들
 */

// GET 요청
export async function apiGet<T = any>(
  url: string,
  params?: Record<string, any>,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  const queryString = params ? `?${serializeParams(params)}` : ''
  const fullUrl = `${url}${queryString}`

  return executeRequest<T>(fullUrl, {
    ...options,
    method: 'GET'
  })
}

// POST 요청
export async function apiPost<T = any>(
  url: string,
  data?: any,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  return executeRequest<T>(url, {
    ...options,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined
  })
}

// PUT 요청
export async function apiPut<T = any>(
  url: string,
  data?: any,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  return executeRequest<T>(url, {
    ...options,
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined
  })
}

// PATCH 요청
export async function apiPatch<T = any>(
  url: string,
  data?: any,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  return executeRequest<T>(url, {
    ...options,
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined
  })
}

// DELETE 요청
export async function apiDelete<T = any>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  return executeRequest<T>(url, {
    ...options,
    method: 'DELETE'
  })
}

/**
 * 파일 업로드
 */
export async function apiUpload<T = any>(
  url: string,
  formData: FormData,
  options: RequestOptions = {}
): Promise<ApiSuccessResponse<T>> {
  const { headers, ...otherOptions } = options
  
  return executeRequest<T>(url, {
    ...otherOptions,
    method: 'POST',
    body: formData,
    headers: {
      // Content-Type을 FormData가 자동 설정하도록 제거
      ...Object.fromEntries(
        Object.entries(headers || {}).filter(([key]) => 
          key.toLowerCase() !== 'content-type'
        )
      )
    }
  })
}

/**
 * React Hook과 통합하기 위한 헬퍼들
 */

// 로딩 상태와 통합된 API 호출
export async function apiWithLoading<T = any>(
  apiCall: () => Promise<ApiSuccessResponse<T>>,
  loadingState: {
    startLoading: () => void
    finishLoading: (result: T) => void
    failLoading: (error: Error) => void
  }
): Promise<T> {
  try {
    loadingState.startLoading()
    const response = await apiCall()
    loadingState.finishLoading(response.data)
    return response.data
  } catch (error) {
    loadingState.failLoading(error as Error)
    throw error
  }
}

/**
 * 캐시 관리 함수들
 */

// 캐시 클리어
export function clearApiCache(pattern?: string): void {
  if (pattern) {
    const regex = new RegExp(pattern)
    for (const key of apiCache.keys()) {
      if (regex.test(key)) {
        apiCache.delete(key)
      }
    }
  } else {
    apiCache.clear()
  }
}

// 특정 캐시 무효화
export function invalidateCache(key: string): void {
  apiCache.delete(key)
}

// 캐시 상태 확인
export function getCacheInfo(): Array<{ key: string; size: number; age: number }> {
  const now = Date.now()
  return Array.from(apiCache.entries()).map(([key, value]) => ({
    key,
    size: JSON.stringify(value.data).length,
    age: now - value.timestamp
  }))
}