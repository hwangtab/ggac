import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Security middleware to add security headers
 * This should be integrated into the main middleware.ts
 */
export function addSecurityHeaders(request: NextRequest, response: NextResponse) {
  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https://www.youtube.com",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src 'self' https://api.supabase.io https://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ')

  // Set security headers
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  
  // Additional security headers for production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }

  return response
}

/**
 * Sanitize user input to prevent XSS attacks
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''
  
  return input
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
    .slice(0, 1000) // Length limit
}

/**
 * Validate URL to prevent malicious redirects
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    const allowedProtocols = ['http:', 'https:']
    return allowedProtocols.includes(parsedUrl.protocol)
  } catch {
    return false
  }
}

/**
 * Sanitize HTML content for safe rendering
 */
export function sanitizeHtml(html: string): string {
  if (typeof html !== 'string') return ''
  
  // Remove all script tags and their content
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  
  // Remove dangerous event handlers
  html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
  
  // Remove javascript: URLs
  html = html.replace(/javascript:/gi, '')
  
  // Remove data: URLs (except for images)
  html = html.replace(/data:(?!image\/)/gi, '')
  
  return html
}