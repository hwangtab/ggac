import { NextResponse } from 'next/server'
import {
  contentDispositionValue,
  contentRangeValue,
  parseByteRange,
  parseContentRange,
} from '@/lib/storage/boardWork'
import { loadWorkStaff } from '@/lib/server/boardWorkAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { getReadableAttachment } from './queries'
import type { Attachment } from './schema'
import {
  RangeNotSatisfiableError,
  readObject,
  StorageUnconfiguredError,
  UnsafeStoragePathError,
} from './storage'
import { StorageUnavailableError } from './storage-errors'

/**
 * 파일 라우트(`/api/board-room/work/files/<id>…`) 공용 — 원본 kosmart-work `api/files/[id]`·`[id]/[name]`은 서명 URL 로
 * 302 했다. ggac 비공개 Blob 은 서명 URL 이 없어 **요청마다 권한을 다시 판정한 뒤 함수가 스트리밍한다**(설계 §7-3,
 * 이사회 서류함과 같은 방식). 경로는 DB 행에서만 오고(`getReadableAttachment`), 저장소 호출 전에 `isSafeBoardWorkPath`가
 * 다시 본다(storage.ts).
 *
 * 각 라우트는 첫 줄에서 `requireBoardMember()`를 부른다(정적 가드가 요구한다). 이 모듈은 그 뒤의 공통 단계다.
 */

/** 모든 파일 응답의 공통 헤더 — 권한이 요청마다 다시 판정되므로 어디에도 캐시하지 않는다 */
export const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const

/**
 * 프레임에 넣지 않는 응답(내려받기·스트리밍·변환 JSON) — 전역과 같은 DENY/'none'.
 * API 경로는 next.config 전역 헤더·미들웨어 CSP 대상이 아니라서 라우트가 직접 붙인다. 내려받은 PDF 를 새 탭에서
 * 바로 열 수도 있어 `sandbox`는 붙이지 않는다(크롬 PDF 뷰어가 막힌다 — 원본 주석과 같다). 이 라우트가 inline 으로
 * 내보내는 형식은 이미지(SVG 제외)·PDF·동영상·오디오뿐이고 나머지는 늘 attachment 다.
 */
export const NOT_FRAMEABLE = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
} as const

/**
 * PDF·이미지 미리보기(`/files/<id>/<name>`)는 같은 출처 `<iframe>`에 뜬다(설계 §7-3) — **이 라우트에만**
 * SAMEORIGIN·`frame-ancestors 'self'`(전역은 DENY·'none'). `sandbox`는 붙이지 않는다(크롬 PDF 뷰어가 막힌다).
 */
export const SAME_ORIGIN_FRAMEABLE = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
} as const

/** 텍스트 미리보기 — 같은 출처에서 열려도 스크립트가 돌지 못하게(원본 TEXT_RESPONSE_CSP) + 같은 출처 프레임만 */
export const TEXT_FRAMEABLE = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
} as const

export function jsonError(
  status: number,
  error: string,
  extra: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { ...NO_STORE, ...NOT_FRAMEABLE, ...extra } }
  )
}

/** requireBoardMember() 통과 뒤 업무툴 역할을 만든다. 업무툴 구성원이 아니면 403 응답 */
export async function workClientFor(userId: string): Promise<WorkServerClient | NextResponse> {
  const staff = await loadWorkStaff(userId)
  if (!staff) return jsonError(403, '이사회 구성원(이사·감사)과 관리자만 쓸 수 있습니다.')
  return { user: { id: userId }, staff }
}

/**
 * 읽을 수 있는 첨부(원본 getReadableAttachment — 읽을 수 있는 채널 + 지워지지 않은 메시지). 아니면 404 응답.
 * 권한 없음과 없음을 구분하지 않는다(존재 여부 노출 방지 — 원본과 같다).
 */
export async function readableAttachmentOr404(
  client: WorkServerClient,
  id: string
): Promise<Attachment | NextResponse> {
  try {
    const attachment = await getReadableAttachment(client, id)
    return attachment ?? jsonError(404, 'Not Found')
  } catch (e) {
    console.error('[board-work/files] 첨부 조회 실패:', e)
    return jsonError(500, 'Server Error')
  }
}

/** 저장소 예외 → 응답(권한 판정은 이미 통과했다). 503: 저장소 미설정, 502: 일시 오류 */
export function storageErrorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof StorageUnconfiguredError) return jsonError(503, 'Storage Not Configured')
  if (e instanceof UnsafeStoragePathError) {
    console.error(`[${where}] 안전하지 않은 경로 — 차단`)
    return jsonError(404, 'Not Found')
  }
  if (e instanceof StorageUnavailableError) {
    console.error(`[${where}] 저장소 오류:`, e)
    return jsonError(502, 'Bad Gateway')
  }
  console.error(`[${where}] 처리 중 예외:`, e)
  return jsonError(500, 'Server Error')
}

/**
 * 객체를 스트리밍한다(Range 지원 — 단일 `bytes=a-b`). 크기는 승격 때 `head()`로 확인해 둔 행의 size 다.
 *   - Range 가 없거나 무시할 모양 → 200 전체
 *   - 단일 범위 → 저장소에 넘기고, 저장소가 `content-range`를 돌려주면 206(아니면 200 전체로 떨어진다)
 *   - 크기 밖 → 416 + `Content-Range: bytes * /<size>`
 * `headers`에는 Content-Type·Content-Disposition·프레임 정책을 담아 넘긴다.
 * `read`는 저장소 계층(기본: 업무툴 `readObject` — `board-work/` 경로만). 조합원 내 문서함은 자기 경로 판정이 붙은
 * 계층(`readMemberDocumentObject`)을 넘긴다(docs/board-work/04-조합원-문서함.md §3-3).
 */
export async function streamObject(opts: {
  path: string
  size: number
  rangeHeader: string | null
  headers: Record<string, string>
  where: string
  read?: typeof readObject
}): Promise<NextResponse> {
  const range = parseByteRange(opts.rangeHeader, opts.size)
  const base = { ...NO_STORE, 'Accept-Ranges': 'bytes', ...opts.headers }
  if (range.kind === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${opts.size}` },
    })
  }
  let obj: Awaited<ReturnType<typeof readObject>>
  try {
    obj = await (opts.read ?? readObject)(opts.path, range.kind === 'range' ? { range } : {})
  } catch (e) {
    if (e instanceof RangeNotSatisfiableError) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...base, 'Content-Range': `bytes */${opts.size}` },
      })
    }
    return storageErrorResponse(e, opts.where)
  }
  if (!obj) return jsonError(404, 'Not Found')

  const partial = range.kind === 'range' ? parseContentRange(obj.contentRange) : null
  if (partial) {
    return new NextResponse(obj.stream, {
      status: 206,
      headers: {
        ...base,
        'Content-Range': contentRangeValue(partial, partial.size ?? opts.size),
        'Content-Length': String(partial.end - partial.start + 1),
      },
    })
  }
  return new NextResponse(obj.stream, {
    status: 200,
    headers: {
      ...base,
      ...(obj.contentLength ? { 'Content-Length': obj.contentLength } : {}),
    },
  })
}

export function inlineDisposition(name: string): string {
  return contentDispositionValue('inline', name)
}

export function attachmentDisposition(name: string): string {
  return contentDispositionValue('attachment', name)
}
