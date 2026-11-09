import type { NextRequest } from 'next/server'

/** 기본 본문 상한 — 일반 JSON 폼은 수 KB, 1MB면 충분하다. */
export const DEFAULT_JSON_BODY_MAX_BYTES = 1_000_000
/** 본문이 큰 편집기·동기화 라우트용 상한(Vercel 요청 본문 한도 4.5MB 아래). */
export const LARGE_JSON_BODY_MAX_BYTES = 4_000_000

/**
 * JSON 객체 본문을 읽는다. 객체가 아니거나 파싱 실패, 상한 초과면 `null`
 * (호출자가 400으로 답한다). `Content-Length`를 먼저 보고, 헤더가 없거나
 * 거짓일 수 있으므로 읽은 뒤 길이도 다시 확인한다.
 */
export async function parseJsonObjectBody(
  request: NextRequest,
  options: { maxBytes?: number } = {}
): Promise<Record<string, unknown> | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES
  try {
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) return null

    const text = await request.text()
    // UTF-16 길이 * 3 이 UTF-8 바이트 상한이므로, 그 아래면 바이트를 셀 필요가 없다.
    if (text.length * 3 > maxBytes && new TextEncoder().encode(text).length > maxBytes) {
      return null
    }
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
