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
