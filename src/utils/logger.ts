/**
 * Production-safe logging utility
 * Automatically removes logs in production while keeping them in development
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private isDev = process.env.NODE_ENV === 'development'

  debug(message: string, ...args: any[]) {
    if (this.isDev) {
      console.debug(message, ...args)
    }
  }

  info(message: string, ...args: any[]) {
    if (this.isDev) {
      console.info(message, ...args)
    }
  }

  /**
   * 운영에서도 **항상** 남기는 정보 줄 — 크론의 실행 요약처럼 "돌았다는 사실" 자체가 증거인 기록용. `info`는 운영에서
   * 지워지므로(위) 그것으로 남긴 요약은 Vercel 로그에 한 줄도 남지 않았다. 개인정보·비밀값을 싣지 말 것.
   *
   * 실행 여부는 `work_cron_runs` 장부(`runTrackedCron`)가 따로 남긴다. 이 줄은 장부에 없는 **무엇을 했는지**를
   * 한 줄로 보이게 하는 용도다 — 장부를 보려면 DB를 열어야 한다.
   *
   * **`console.warn`(stderr)으로 낸다.** 2026-11-06 실측: 이 프로젝트의 런타임 로그에는 stderr만 실린다 —
   * `vercel logs -q "stream: stdout" --since 6h`가 0건이었고, 성공한 크론(`work_cron_runs.last_status='ok'`)도
   * `console.info` 줄은 조회되지 않았다(오류 줄은 보인다). 표준출력으로 내면 대시보드·CLI 어디에서도 볼 수 없다.
   * 경보가 이 줄에 걸리지는 않는다(경보는 `alertOpsAdmins`·`logSecurityEvent`가 따로 낸다).
   */
  summary(message: string, ...args: any[]) {
    console.warn(message, ...args)
  }

  warn(message: string, ...args: any[]) {
    console.warn(message, ...args)
  }

  error(message: string, ...args: any[]) {
    console.error(message, ...args)
  }

  log(message: string, ...args: any[]) {
    if (this.isDev) {
      console.log(message, ...args)
    }
  }
}

export const logger = new Logger()

// Convenience functions for specific contexts
export const createLogger = (context: string) => ({
  debug: (message: string, ...args: any[]) => logger.debug(`[${context}] ${message}`, ...args),
  info: (message: string, ...args: any[]) => logger.info(`[${context}] ${message}`, ...args),
  summary: (message: string, ...args: any[]) => logger.summary(`[${context}] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(`[${context}] ${message}`, ...args),
  error: (message: string, ...args: any[]) => logger.error(`[${context}] ${message}`, ...args),
  log: (message: string, ...args: any[]) => logger.log(`[${context}] ${message}`, ...args),
})

/**
 * 식별자 마스킹 (PII 로그 노출 최소화)
 * 사용자 UUID/요청 ID 등 식별자를 그대로 로깅하면 민감정보가 노출되므로,
 * 앞 6글자만 남기고 나머지는 잘라낸다. 디버깅 단서로는 충분히 유지된다.
 */
export const maskId = (id?: string | null): string | undefined =>
  id ? `${id.slice(0, 6)}…` : undefined
