import { NextRequest, NextResponse } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/utils/apiResponse'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    if (!body.message || !body.timestamp) {
      return createErrorResponse('Missing required fields: message, timestamp', 400)
    }

    // Construct error log entry
    const errorLog = {
      timestamp: body.timestamp,
      url: body.url || 'unknown',
      message: body.message,
      stack: body.stack,
      componentStack: body.componentStack,
      userAgent: body.userAgent || request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      errorId: body.errorId || `client_error_${Date.now()}`,
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
