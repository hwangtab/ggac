/**
 * 활동 로깅 유틸리티
 * 사용자 활동을 자동으로 추적하고 기록하는 시스템
 */

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { 
  ActivityActionType, 
  ActivityTargetType, 
  ActivityLogRequest,
  UserSession 
} from '@/types'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none'

interface ActivityLoggerConfig {
  enableConsoleLogging?: boolean
  enableBatching?: boolean
  batchSize?: number
  flushInterval?: number
  logLevel?: LogLevel
}

class ActivityLogger {
  private supabase = createClientComponentClient()
  private config: ActivityLoggerConfig
  private sessionId: string | null = null
  private sessionToken: string | null = null
  private pendingLogs: ActivityLogRequest[] = []
  private flushTimer: NodeJS.Timeout | null = null

  /**
   * 안전한 로깅 메소드 - 민감한 정보 필터링
   */
  private secureLog(level: LogLevel, message: string, data?: any) {
    // 로그 레벨 확인
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      none: 4
    }
    
    if (levels[level] < levels[this.config.logLevel || 'error']) {
      return
    }
    
    if (!this.config.enableConsoleLogging) {
      return
    }
    
    // 민감한 정보 필터링
    const sanitizedData = this.sanitizeLogData(data)
    
    const logMethod = (console as any)[level] || console.log
    if (sanitizedData) {
      logMethod(`[ActivityLogger:${level.toUpperCase()}] ${message}`, sanitizedData)
    } else {
      logMethod(`[ActivityLogger:${level.toUpperCase()}] ${message}`)
    }
  }

  /**
   * 로그 데이터에서 민감한 정보 제거
   */
  private sanitizeLogData(data: any): any {
    if (!data) return data
    
    const sensitiveKeys = [
      'access_token', 'refresh_token', 'token', 'password', 'secret', 'key',
      'authorization', 'bearer', 'session_token', 'apikey', 'api_key',
      'supabase_anon_key', 'supabase_service_role_key'
    ]
    
    if (typeof data === 'string') {
      // JWT 토큰이나 API 키 패턴 검출 및 마스킹
      return data.replace(/^(ey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*)/g, '[JWT_TOKEN_REDACTED]')
                .replace(/^(sb-[a-zA-Z0-9]{20,})/g, '[SUPABASE_KEY_REDACTED]')
                .replace(/^([A-Za-z0-9]{32,})/g, '[API_KEY_REDACTED]')
    }
    
    if (typeof data !== 'object' || data === null) {
      return data
    }
    
    const sanitized = Array.isArray(data) ? [...data] : { ...data }
    
    const sanitizeRecursive = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj
      }
      
      if (Array.isArray(obj)) {
        return obj.map(sanitizeRecursive)
      }
      
      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
          result[key] = '[REDACTED]'
        } else if (typeof value === 'object' && value !== null) {
          result[key] = sanitizeRecursive(value)
        } else {
          result[key] = value
        }
      }
      return result
    }
    
    return sanitizeRecursive(sanitized)
  }

  constructor(config: ActivityLoggerConfig = {}) {
    this.config = {
      enableConsoleLogging: process.env.NODE_ENV === 'development',
      enableBatching: false,
      batchSize: 10,
      flushInterval: 5000, // 5초
      logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'error',
      ...config
    }

    // 브라우저에서만 실행
    if (typeof window !== 'undefined') {
      this.initializeSession()
      this.setupEventListeners()
    }
  }

  /**
   * 세션 초기화
   */
  private async initializeSession() {
    try {
      this.secureLog('debug', '세션 초기화 시작')

      const { data: { session }, error: sessionError } = await this.supabase.auth.getSession()
      
      if (sessionError) {
        this.secureLog('error', '세션 조회 오류', sessionError)
        return
      }
      
      if (session?.user) {
        this.sessionToken = session.access_token
        this.secureLog('debug', '사용자 세션 확인됨', { userId: session.user.id })
        await this.startSession(session.user.id)
      } else {
        this.secureLog('debug', '인증되지 않은 사용자 - 활동 로깅 비활성화')
      }

      // 인증 상태 변경 리스너
      this.supabase.auth.onAuthStateChange(async (event, session) => {
        this.secureLog('debug', '인증 상태 변경', { event })
        
        if (event === 'SIGNED_IN' && session?.user) {
          this.sessionToken = session.access_token
          await this.startSession(session.user.id)
        } else if (event === 'SIGNED_OUT') {
          await this.endSession()
          this.sessionToken = null
          this.sessionId = null
        }
      })
    } catch (error) {
      this.secureLog('error', '세션 초기화 오류', error)
    }
  }

  /**
   * 이벤트 리스너 설정
   */
  private setupEventListeners() {
    // 페이지 언로드 시 세션 종료 및 대기 중인 로그 플러시
    window.addEventListener('beforeunload', () => {
      this.flushPendingLogs()
      if (this.sessionId) {
        // 동기적으로 로그아웃 기록 (백그라운드에서)
        navigator.sendBeacon('/api/activities/logout', JSON.stringify({
          session_id: this.sessionId
        }))
      }
    })

    // 페이지 가시성 변경 시 활동 업데이트
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.sessionId) {
        this.updateSessionActivity()
      }
    })

    // 주기적으로 세션 활동 업데이트 (5분마다)
    setInterval(() => {
      if (!document.hidden && this.sessionId) {
        this.updateSessionActivity()
      }
    }, 5 * 60 * 1000)
  }

  /**
   * 세션 시작
   */
  private async startSession(userId: string) {
    try {
      const sessionToken = this.generateSessionToken()
      const metadata = {
        browser: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: `${screen.width}x${screen.height}`,
        language: navigator.language
      }

      const response = await fetch('/api/activities/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionToken}`
        },
        body: JSON.stringify({
          action: 'start',
          session_token: sessionToken,
          metadata
        })
      })

      if (response.ok) {
        const data = await response.json()
        this.sessionId = data.session_id
        
        this.secureLog('debug', '활동 추적 세션 시작', { sessionId: this.sessionId })
      }
    } catch (error) {
      this.secureLog('error', '세션 시작 오류', error)
    }
  }

  /**
   * 세션 종료
   */
  private async endSession() {
    if (!this.sessionId) return

    try {
      await fetch('/api/activities/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionToken}`
        },
        body: JSON.stringify({
          action: 'end',
          session_id: this.sessionId
        })
      })

      this.secureLog('debug', '활동 추적 세션 종료', { sessionId: this.sessionId })
    } catch (error) {
      this.secureLog('error', '세션 종료 오류', error)
    }
  }

  /**
   * 세션 활동 업데이트
   */
  private async updateSessionActivity() {
    if (!this.sessionId) return

    try {
      await fetch('/api/activities/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionToken}`
        },
        body: JSON.stringify({
          action: 'update',
          session_id: this.sessionId,
          metadata: {
            last_page: window.location.pathname,
            timestamp: new Date().toISOString()
          }
        })
      })
    } catch (error) {
      this.secureLog('error', '세션 활동 업데이트 오류', error)
    }
  }

  /**
   * 활동 로그 기록 (공개 메소드)
   */
  public async logActivity(request: ActivityLogRequest): Promise<boolean> {
    // 브라우저 환경이 아니거나 window 객체가 없으면 조기 반환
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const enhancedRequest = {
        ...request,
        metadata: {
          ...request.metadata,
          page: window.location?.pathname || '',
          referrer: document?.referrer || '',
          timestamp: new Date().toISOString(),
          session_id: this.sessionId
        }
      }

      if (this.config.enableBatching) {
        this.addToBatch(enhancedRequest)
      } else {
        await this.sendLog(enhancedRequest)
      }

      this.secureLog('debug', '활동 로그', enhancedRequest)

      return true
    } catch (error) {
      this.secureLog('error', '활동 로깅 오류', error)
      return false
    }
  }

  /**
   * 배치에 로그 추가
   */
  private addToBatch(request: ActivityLogRequest) {
    this.pendingLogs.push(request)

    if (this.pendingLogs.length >= this.config.batchSize!) {
      this.flushPendingLogs()
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushPendingLogs()
      }, this.config.flushInterval!)
    }
  }

  /**
   * 대기 중인 로그 플러시
   */
  private async flushPendingLogs() {
    if (this.pendingLogs.length === 0) return

    const logsToSend = [...this.pendingLogs]
    this.pendingLogs = []

    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    try {
      await this.sendBatchLogs(logsToSend)
    } catch (error) {
      this.secureLog('error', '배치 로그 전송 오류', error)
      // 실패한 로그를 다시 대기열에 추가 (최대 3회 재시도)
      logsToSend.forEach(log => {
        const retryCount = (log.metadata?.retryCount || 0) + 1
        if (retryCount <= 3) {
          this.pendingLogs.push({
            ...log,
            metadata: { ...log.metadata, retryCount }
          })
        }
      })
    }
  }

  /**
   * 단일 로그 전송
   */
  private async sendLog(request: ActivityLogRequest): Promise<void> {
    this.secureLog('debug', '로그 전송 시도', request)

    const response = await fetch('/api/activities/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      const errorText = await response.text()
      this.secureLog('error', `로그 전송 실패 (${response.status})`, { errorText })
      throw new Error(`로그 전송 실패: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    this.secureLog('debug', '로그 전송 성공', result)
  }

  /**
   * 배치 로그 전송
   */
  private async sendBatchLogs(logs: ActivityLogRequest[]): Promise<void> {
    const response = await fetch('/api/activities/batch-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify({ logs })
    })

    if (!response.ok) {
      throw new Error(`배치 로그 전송 실패: ${response.status}`)
    }
  }

  /**
   * 세션 토큰 생성
   */
  private generateSessionToken(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2)}`
  }

  /**
   * 특정 활동 타입들을 위한 편의 메소드들
   */
  public async logPageView(path: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'page_viewed',
      target_type: 'system',
      metadata: { path, ...metadata }
    })
  }

  public async logPostCreated(postId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'post_created',
      target_type: 'post',
      target_id: postId,
      metadata
    })
  }

  public async logPostUpdated(postId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'post_updated',
      target_type: 'post',
      target_id: postId,
      metadata
    })
  }

  public async logCommentCreated(commentId: string, postId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'comment_created',
      target_type: 'comment',
      target_id: commentId,
      metadata: { post_id: postId, ...metadata }
    })
  }

  public async logLikeAdded(postId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'like_added',
      target_type: 'post',
      target_id: postId,
      metadata
    })
  }

  public async logLikeRemoved(postId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'like_removed',
      target_type: 'post',
      target_id: postId,
      metadata
    })
  }

  public async logProfileUpdated(section: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'profile_updated',
      target_type: 'profile',
      metadata: { section, ...metadata }
    })
  }

  public async logFileUploaded(fileId: string, fileType: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'file_uploaded',
      target_type: 'file',
      target_id: fileId,
      metadata: { file_type: fileType, ...metadata }
    })
  }

  public async logSearch(query: string, results: number, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'search_performed',
      target_type: 'system',
      metadata: { query, results_count: results, ...metadata }
    })
  }

  public async logNotificationRead(notificationId: string, metadata?: Record<string, any>) {
    return this.logActivity({
      action_type: 'notification_read',
      target_type: 'notification',
      target_id: notificationId,
      metadata
    })
  }
}

// 싱글톤 인스턴스 생성
const activityLogger = new ActivityLogger()

export default activityLogger

// 안전한 함수 래퍼들 - this 바인딩 보존
export const logActivity = (request: ActivityLogRequest) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logActivity(request)
}

export const logPageView = (path: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logPageView(path, metadata)
}

export const logPostCreated = (postId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logPostCreated(postId, metadata)
}

export const logPostUpdated = (postId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logPostUpdated(postId, metadata)
}

export const logCommentCreated = (commentId: string, postId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logCommentCreated(commentId, postId, metadata)
}

export const logLikeAdded = (postId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logLikeAdded(postId, metadata)
}

export const logLikeRemoved = (postId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logLikeRemoved(postId, metadata)
}

export const logProfileUpdated = (section: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logProfileUpdated(section, metadata)
}

export const logFileUploaded = (fileId: string, fileType: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logFileUploaded(fileId, fileType, metadata)
}

export const logSearch = (query: string, results: number, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logSearch(query, results, metadata)
}

export const logNotificationRead = (notificationId: string, metadata?: Record<string, any>) => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return activityLogger.logNotificationRead(notificationId, metadata)
}