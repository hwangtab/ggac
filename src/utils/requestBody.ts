import { NextRequest } from 'next/server'

export async function parseJsonObjectBody(
  request: NextRequest
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
