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

interface ActivityLoggerConfig {
  enableConsoleLogging?: boolean
  enableBatching?: boolean
  batchSize?: number
  flushInterval?: number
}

class ActivityLogger {
  private supabase = createClientComponentClient()
  private config: ActivityLoggerConfig
  private sessionId: string | null = null
  private sessionToken: string | null = null
  private pendingLogs: ActivityLogRequest[] = []
  private flushTimer: NodeJS.Timeout | null = null

  constructor(config: ActivityLoggerConfig = {}) {
    this.config = {
      enableConsoleLogging: process.env.NODE_ENV === 'development',
      enableBatching: false,
      batchSize: 10,
      flushInterval: 5000, // 5초
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
      const { data: { session } } = await this.supabase.auth.getSession()
      
      if (session?.user) {
        this.sessionToken = session.access_token
        await this.startSession(session.user.id)
      }

      // 인증 상태 변경 리스너
      this.supabase.auth.onAuthStateChange(async (event, session) => {
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
      console.error('세션 초기화 오류:', error)
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
        
        if (this.config.enableConsoleLogging) {
          console.log('활동 추적 세션 시작:', this.sessionId)
        }
      }
    } catch (error) {
      console.error('세션 시작 오류:', error)
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

      if (this.config.enableConsoleLogging) {
        console.log('활동 추적 세션 종료:', this.sessionId)
      }
    } catch (error) {
      console.error('세션 종료 오류:', error)
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
      console.error('세션 활동 업데이트 오류:', error)
    }
  }

  /**
   * 활동 로그 기록 (공개 메소드)
   */
  public async logActivity(request: ActivityLogRequest): Promise<boolean> {
    try {
      const enhancedRequest = {
        ...request,
        metadata: {
          ...request.metadata,
          page: window.location.pathname,
          referrer: document.referrer,
          timestamp: new Date().toISOString(),
          session_id: this.sessionId
        }
      }

      if (this.config.enableBatching) {
        this.addToBatch(enhancedRequest)
      } else {
        await this.sendLog(enhancedRequest)
      }

      if (this.config.enableConsoleLogging) {
        console.log('활동 로그:', enhancedRequest)
      }

      return true
    } catch (error) {
      console.error('활동 로깅 오류:', error)
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
      console.error('배치 로그 전송 오류:', error)
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
    const response = await fetch('/api/activities/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      throw new Error(`로그 전송 실패: ${response.status}`)
    }
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

// 편의 함수들을 개별적으로 내보내기
export const {
  logActivity,
  logPageView,
  logPostCreated,
  logPostUpdated,
  logCommentCreated,
  logLikeAdded,
  logLikeRemoved,
  logProfileUpdated,
  logFileUploaded,
  logSearch,
  logNotificationRead
} = activityLogger