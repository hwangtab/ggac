import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/client-error')

const MAX_FIELD_LENGTH = 4096
const MAX_MESSAGE_LENGTH = 1024

async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request)

    if (!body?.message || !body.timestamp) {
      return ApiError.badRequest('Missing required fields: message, timestamp').toNextResponse()
    }

    const message = String(body.message || '').slice(0, MAX_MESSAGE_LENGTH)
    const stack = body.stack ? String(body.stack).slice(0, MAX_FIELD_LENGTH) : undefined
    const componentStack = body.componentStack
      ? String(body.componentStack).slice(0, MAX_FIELD_LENGTH)
      : undefined
    const url = body.url ? String(body.url).slice(0, 512) : 'unknown'

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

    log.error('Client Error Logged', {
      errorId: errorLog.errorId,
      url: errorLog.url,
      message: errorLog.message,
      timestamp: errorLog.timestamp,
    })

    if (process.env.NODE_ENV === 'development') {
      log.debug('Full Error Details', errorLog)
    }

    return ApiSuccess.ok({
      logged: true,
      errorId: errorLog.errorId,
    }).toNextResponse()
  } catch (error) {
    log.error('Failed to log client error', error)
    return ApiError.internalServerError('Failed to log client error').toNextResponse()
  }
}

export async function GET() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}

export async function PUT() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}

export async function DELETE() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}
