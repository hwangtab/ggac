/**
 * Security utilities for input validation and sanitization
 */

/**
 * HTML escape function to prevent XSS attacks
 */
export function escapeHtml(unsafe: string): string {
  if (typeof unsafe !== 'string') return ''
  
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}

/**
 * Sanitize text content for safe display
 */
export function sanitizeText(text: string): string {
  if (typeof text !== 'string') return ''
  
  return text
    .replace(/[<>\"'&]/g, (char) => {
      const map: { [key: string]: string } = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;'
      }
      return map[char] || char
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000) // Length limit
}

/**
 * Validate and sanitize URL
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') return ''
  
  try {
    const parsedUrl = new URL(url)
    const allowedProtocols = ['http:', 'https:']
    
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      return ''
    }
    
    return parsedUrl.toString()
  } catch {
    return ''
  }
}

/**
 * Validate email address
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return typeof email === 'string' && emailRegex.test(email)
}

/**
 * Sanitize JSON-LD structured data
 */
export function sanitizeJsonLd(data: any): any {
  if (typeof data === 'string') {
    return sanitizeText(data)
  } else if (Array.isArray(data)) {
    return data.map(item => sanitizeJsonLd(item))
  } else if (typeof data === 'object' && data !== null) {
    const sanitized: any = {}
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeJsonLd(value)
    }
    return sanitized
  }
  return data
}

/**
 * Create safe DOM element with text content
 */
export function createSafeElement(tag: string, className?: string, textContent?: string): HTMLElement {
  const element = document.createElement(tag)
  
  if (className) {
    element.className = className
  }
  
  if (textContent) {
    element.textContent = textContent // Use textContent to prevent XSS
  }
  
  return element
}

/**
 * Rate limiting utility for API endpoints
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  
  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 60000 // 1 minute
  ) {}
  
  isAllowed(identifier: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(identifier) || []
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => now - time < this.windowMs)
    
    if (validRequests.length >= this.maxRequests) {
      return false
    }
    
    validRequests.push(now)
    this.requests.set(identifier, validRequests)
    
    return true
  }
}

/**
 * Logging utility for security events
 */
export function logSecurityEvent(event: string, details: any = {}): void {
  const timestamp = new Date().toISOString()
  const logData = {
    timestamp,
    event,
    details,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'Unknown'
  }
  
  // In production, send to monitoring service
  if (process.env.NODE_ENV === 'production') {
    // TODO: Implement proper logging to monitoring service
    console.warn('SECURITY EVENT:', JSON.stringify(logData))
  } else {
    console.log('Security Event:', logData)
  }
}