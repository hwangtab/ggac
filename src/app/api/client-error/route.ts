import { NextRequest, NextResponse } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/utils/apiResponse'

const MAX_FIELD_LENGTH = 4096 // 4KB per field
const MAX_MESSAGE_LENGTH = 1024

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    if (!body.message || !body.timestamp) {
      return createErrorResponse('Missing required fields: message, timestamp', 400)
    }

    // 입력 길이 제한 (로그 인플레이션 방지)
    const message = String(body.message || '').slice(0, MAX_MESSAGE_LENGTH)
    const stack = body.stack ? String(body.stack).slice(0, MAX_FIELD_LENGTH) : undefined
    const componentStack = body.componentStack
      ? String(body.componentStack).slice(0, MAX_FIELD_LENGTH)
      : undefined
    const url = body.url ? String(body.url).slice(0, 512) : 'unknown'

    // Construct error log entry
    const errorLog = {
      timestamp: body.timestamp,
      url,
      message,
      stack,
      componentStack,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      errorId: body.errorId ? String(body.errorId).slice(0, 64) : `client_error_${Date.now()}`,
      level: 'error',
      source: 'client',
    }

    // Log to console for now (in production, you might want to send to external service)
    console.error('Client Error Logged:', {
      errorId: errorLog.errorId,
      url: errorLog.url,
      message: errorLog.message,
      timestamp: errorLog.timestamp,
      userAgent: errorLog.userAgent,
      ip: errorLog.ip,
    })

    // In development, log full stack trace
    if (process.env.NODE_ENV === 'development') {
      console.error('Full Error Details:', errorLog)
    }

    // In production, you might want to:
    // 1. Send to external logging service (Sentry, DataDog, etc.)
    // 2. Store in database for analysis
    // 3. Send alerts for critical errors

    return createSuccessResponse({
      logged: true,
      errorId: errorLog.errorId,
    })
  } catch (error) {
    console.error('Error logging client error:', error)
    return createErrorResponse('Failed to log client error', 500)
  }
}

// Only allow POST requests
export async function GET() {
  return createErrorResponse('Only POST requests are allowed', 405)
}

export async function PUT() {
  return createErrorResponse('Only POST requests are allowed', 405)
}

export async function DELETE() {
  return createErrorResponse('Only POST requests are allowed', 405)
}
