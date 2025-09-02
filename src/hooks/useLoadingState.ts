/**
 * 통합 로딩 상태 관리 훅
 * 
 * 다양한 비동기 작업의 로딩 상태를 일관되게 관리합니다.
 * - 단일/다중 작업 로딩 상태
 * - 에러 상태 관리
 * - 자동 타임아웃 처리
 * - 로딩 상태 추적 및 로깅
 */

'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

// 로딩 상태 타입 정의
export interface LoadingState {
  isLoading: boolean
  error: string | null
  lastUpdated: Date | null
  startTime: Date | null
  duration: number | null
}

// 다중 작업 로딩 상태
export interface MultiLoadingState {
  states: Record<string, LoadingState>
  isAnyLoading: boolean
  hasAnyError: boolean
  globalError: string | null
}

// 비동기 작업 옵션
export interface AsyncOperationOptions {
  /** 작업 식별자 (다중 작업용) */
  key?: string
  /** 타임아웃 (밀리초) */
  timeout?: number
  /** 성공 시 콜백 */
  onSuccess?: (result: any) => void
  /** 실패 시 콜백 */
  onError?: (error: Error) => void
  /** 완료 시 콜백 (성공/실패 무관) */
  onComplete?: () => void
  /** 에러 발생 시 자동으로 상태 초기화할지 여부 */
  clearErrorOnRetry?: boolean
  /** 로딩 상태 로깅 여부 */
  enableLogging?: boolean
}

// 기본 옵션
const DEFAULT_OPTIONS: Partial<AsyncOperationOptions> = {
  timeout: 30000, // 30초
  clearErrorOnRetry: true,
  enableLogging: false
}

/**
 * 단일 작업 로딩 상태 관리 훅
 */
export function useLoadingState(initialOptions?: Partial<AsyncOperationOptions>) {
  const options = useMemo(() => ({ ...DEFAULT_OPTIONS, ...initialOptions }), [initialOptions])
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const [state, setState] = useState<LoadingState>({
    isLoading: false,
    error: null,
    lastUpdated: null,
    startTime: null,
    duration: null
  })

  // 로딩 시작
  const startLoading = useCallback(() => {
    const startTime = new Date()
    
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: options.clearErrorOnRetry ? null : prev.error,
      startTime,
      duration: null
    }))

    // 타임아웃 설정
    if (options.timeout && options.timeout > 0) {
      timeoutRef.current = setTimeout(() => {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: '요청이 시간 초과되었습니다.',
          lastUpdated: new Date(),
          duration: Date.now() - startTime.getTime()
        }))
        
        if (options.enableLogging) {
          console.warn('[LoadingState] Operation timed out after', options.timeout, 'ms')
        }
      }, options.timeout)
    }

    if (options.enableLogging) {
      console.log('[LoadingState] Started loading')
    }
  }, [options])

  // 로딩 완료 (성공)
  const finishLoading = useCallback((result?: any) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    setState(prev => {
      const duration = prev.startTime ? Date.now() - prev.startTime.getTime() : null
      const newState = {
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
        startTime: prev.startTime,
        duration
      }

      if (options.enableLogging) {
        console.log('[LoadingState] Finished loading in', duration, 'ms')
      }

      return newState
    })

    if (options.onSuccess) {
      options.onSuccess(result)
    }
    
    if (options.onComplete) {
      options.onComplete()
    }
  }, [options])

  // 로딩 실패
  const failLoading = useCallback((error: string | Error) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    const errorMessage = error instanceof Error ? error.message : error
    
    setState(prev => {
      const duration = prev.startTime ? Date.now() - prev.startTime.getTime() : null
      const newState = {
        isLoading: false,
        error: errorMessage,
        lastUpdated: new Date(),
        startTime: prev.startTime,
        duration
      }

      if (options.enableLogging) {
        console.error('[LoadingState] Failed after', duration, 'ms:', errorMessage)
      }

      return newState
    })

    if (options.onError) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options.onError(errorObj)
    }
    
    if (options.onComplete) {
      options.onComplete()
    }
  }, [options])

  // 에러 상태 초기화
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  // 전체 상태 초기화
  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    setState({
      isLoading: false,
      error: null,
      lastUpdated: null,
      startTime: null,
      duration: null
    })

    if (options.enableLogging) {
      console.log('[LoadingState] Reset state')
    }
  }, [options])

  // 비동기 작업 래퍼
  const executeAsync = useCallback(async <T>(
    operation: () => Promise<T>,
    operationOptions?: Partial<AsyncOperationOptions>
  ): Promise<T | undefined> => {
    const mergedOptions = { ...options, ...operationOptions }
    
    try {
      startLoading()
      const result = await operation()
      finishLoading(result)
      return result
    } catch (error) {
      failLoading(error as Error)
      throw error
    }
  }, [startLoading, finishLoading, failLoading, options])

  // 컴포넌트 언마운트 시 클린업
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return {
    ...state,
    startLoading,
    finishLoading,
    failLoading,
    clearError,
    reset,
    executeAsync
  }
}

/**
 * 다중 작업 로딩 상태 관리 훅
 */
export function useMultiLoadingState(globalOptions?: Partial<AsyncOperationOptions>) {
  const options = useMemo(() => ({ ...DEFAULT_OPTIONS, ...globalOptions }), [globalOptions])
  const timeoutRefs = useRef<Record<string, NodeJS.Timeout>>({})
  
  const [state, setState] = useState<MultiLoadingState>({
    states: {},
    isAnyLoading: false,
    hasAnyError: false,
    globalError: null
  })

  // 상태 계산 헬퍼
  const calculateGlobalState = useCallback((states: Record<string, LoadingState>) => {
    const stateValues = Object.values(states)
    return {
      isAnyLoading: stateValues.some(s => s.isLoading),
      hasAnyError: stateValues.some(s => s.error !== null),
      globalError: stateValues.find(s => s.error)?.error || null
    }
  }, [])

  // 특정 키의 로딩 시작
  const startLoading = useCallback((key: string) => {
    const startTime = new Date()
    
    setState(prev => {
      const newStates = {
        ...prev.states,
        [key]: {
          isLoading: true,
          error: options.clearErrorOnRetry ? null : (prev.states[key]?.error || null),
          lastUpdated: null,
          startTime,
          duration: null
        }
      }

      return {
        ...prev,
        states: newStates,
        ...calculateGlobalState(newStates)
      }
    })

    // 타임아웃 설정
    if (options.timeout && options.timeout > 0) {
      if (timeoutRefs.current[key]) {
        clearTimeout(timeoutRefs.current[key])
      }
      
      timeoutRefs.current[key] = setTimeout(() => {
        failLoading(key, '요청이 시간 초과되었습니다.')
      }, options.timeout)
    }

    if (options.enableLogging) {
      console.log(`[MultiLoadingState] Started loading for key: ${key}`)
    }
  }, [options, calculateGlobalState])

  // 특정 키의 로딩 완료
  const finishLoading = useCallback((key: string, result?: any) => {
    if (timeoutRefs.current[key]) {
      clearTimeout(timeoutRefs.current[key])
      delete timeoutRefs.current[key]
    }

    setState(prev => {
      const currentState = prev.states[key]
      const duration = currentState?.startTime ? Date.now() - currentState.startTime.getTime() : null
      
      const newStates = {
        ...prev.states,
        [key]: {
          isLoading: false,
          error: null,
          lastUpdated: new Date(),
          startTime: currentState?.startTime || null,
          duration
        }
      }

      if (options.enableLogging) {
        console.log(`[MultiLoadingState] Finished loading for key: ${key} in ${duration}ms`)
      }

      return {
        ...prev,
        states: newStates,
        ...calculateGlobalState(newStates)
      }
    })

    if (options.onSuccess) {
      options.onSuccess(result)
    }
  }, [options, calculateGlobalState])

  // 특정 키의 로딩 실패
  const failLoading = useCallback((key: string, error: string | Error) => {
    if (timeoutRefs.current[key]) {
      clearTimeout(timeoutRefs.current[key])
      delete timeoutRefs.current[key]
    }

    const errorMessage = error instanceof Error ? error.message : error

    setState(prev => {
      const currentState = prev.states[key]
      const duration = currentState?.startTime ? Date.now() - currentState.startTime.getTime() : null
      
      const newStates = {
        ...prev.states,
        [key]: {
          isLoading: false,
          error: errorMessage,
          lastUpdated: new Date(),
          startTime: currentState?.startTime || null,
          duration
        }
      }

      if (options.enableLogging) {
        console.error(`[MultiLoadingState] Failed loading for key: ${key} after ${duration}ms:`, errorMessage)
      }

      return {
        ...prev,
        states: newStates,
        ...calculateGlobalState(newStates)
      }
    })

    if (options.onError) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options.onError(errorObj)
    }
  }, [options, calculateGlobalState])

  // 특정 키의 에러 초기화
  const clearError = useCallback((key: string) => {
    setState(prev => {
      const newStates = {
        ...prev.states,
        [key]: {
          ...prev.states[key],
          error: null
        }
      }

      return {
        ...prev,
        states: newStates,
        ...calculateGlobalState(newStates)
      }
    })
  }, [calculateGlobalState])

  // 특정 키의 상태 초기화
  const reset = useCallback((key?: string) => {
    if (key) {
      // 특정 키만 초기화
      if (timeoutRefs.current[key]) {
        clearTimeout(timeoutRefs.current[key])
        delete timeoutRefs.current[key]
      }

      setState(prev => {
        const newStates = { ...prev.states }
        delete newStates[key]

        return {
          ...prev,
          states: newStates,
          ...calculateGlobalState(newStates)
        }
      })
    } else {
      // 전체 초기화
      Object.values(timeoutRefs.current).forEach(timeout => clearTimeout(timeout))
      timeoutRefs.current = {}
      
      setState({
        states: {},
        isAnyLoading: false,
        hasAnyError: false,
        globalError: null
      })
    }

    if (options.enableLogging) {
      console.log(`[MultiLoadingState] Reset ${key ? `key: ${key}` : 'all states'}`)
    }
  }, [options, calculateGlobalState])

  // 비동기 작업 래퍼
  const executeAsync = useCallback(async <T>(
    key: string,
    operation: () => Promise<T>,
    operationOptions?: Partial<AsyncOperationOptions>
  ): Promise<T | undefined> => {
    const mergedOptions = { ...options, ...operationOptions }
    
    try {
      startLoading(key)
      const result = await operation()
      finishLoading(key, result)
      return result
    } catch (error) {
      failLoading(key, error as Error)
      throw error
    }
  }, [startLoading, finishLoading, failLoading, options])

  // 특정 키의 로딩 상태 가져오기
  const getLoadingState = useCallback((key: string): LoadingState => {
    return state.states[key] || {
      isLoading: false,
      error: null,
      lastUpdated: null,
      startTime: null,
      duration: null
    }
  }, [state.states])

  // 컴포넌트 언마운트 시 클린업
  useEffect(() => {
    return () => {
      Object.values(timeoutRefs.current).forEach(timeout => clearTimeout(timeout))
    }
  }, [])

  return {
    ...state,
    startLoading,
    finishLoading,
    failLoading,
    clearError,
    reset,
    executeAsync,
    getLoadingState
  }
}

/**
 * 간편한 비동기 작업 실행 훅
 */
export function useAsyncOperation<T = any>(
  operation: () => Promise<T>,
  options?: Partial<AsyncOperationOptions>
) {
  const loadingState = useLoadingState(options)
  
  const execute = useCallback(async (overrideOptions?: Partial<AsyncOperationOptions>) => {
    return loadingState.executeAsync(operation, overrideOptions)
  }, [loadingState, operation])

  return {
    ...loadingState,
    execute
  }
}