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
