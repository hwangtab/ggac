import { NextResponse, type NextRequest } from 'next/server'
import { jsonError, NO_STORE, NOT_FRAMEABLE } from './file-response'
import { LayoutRateLimited, loadLayoutManifest, loadLayoutPage } from './layout-pages'
import { convertDocument, converterVersion, renderFormatOf } from './render-document'
import { hitRenderLimit, recallRenderFailure, rememberRenderFailure } from './render-guard'
import { layoutVersion } from './render-layout'
import {
  isLayoutFile,
  RENDER_ERROR_MESSAGE,
  RENDER_ERROR_STATUS,
  RENDER_MAX_BYTES,
  RENDER_MAX_RESPONSE_BYTES,
  RenderError,
  renderCachePath,
  type RenderErrorCode,
  type RenderedDocument,
} from './render-types'
import { downloadObject, StorageUnconfiguredError, uploadBuffer } from './storage'

/**
 * 문서·시트 뷰어 변환 응답(서버 전용) — `/api/board-room/work/files/<id>/render`(업무툴 첨부)와
 * `/api/board-room/work/board-documents/<id>/render`(자료실의 이사회 서류, 03 §10)가 함께 쓴다.
 * **권한 판정은 호출 전에 끝나 있어야 한다**(각 라우트가 첫 줄에서 `requireBoardMember()` → 대상 행 확인). 여기서는
 * 원본을 읽는 방법(`readOriginal`)만 받아 형식·크기 검사, 변환, 캐시(`board-work/renders/<id>-…`)를 한다.
 * 보호 장치는 원본 그대로: 크기 상한(RENDER_MAX_BYTES)·압축 폭탄 검사(zip-guard)·변환 시간 제한·결정적 실패 기억·
 * 사용자당 변환 횟수(분산 리미터 WORK_RENDER·WORK_RENDER_THUMB).
 */
export type RenderSource = {
  /** 캐시 키 — 첨부 id 또는 이사회 서류 id(둘 다 UUID라 겹치지 않는다) */
  id: string
  name: string
  /** 행의 크기(바이트). 실제 바이트로 한 번 더 막는다 */
  size: number
  /** 원본 바이트. 없거나 읽기 실패면 던진다(→ 404, 저장소 미설정은 503) */
  readOriginal: () => Promise<Buffer>
}

const HEADERS = { ...NO_STORE, ...NOT_FRAMEABLE }

// 쪽 SVG 는 이미지(<img>)로만 쓰인다 — 스크립트·외부 요청이 돌지 못하게 문서 단위로 막는다(원본 SVG_RESPONSE_CSP).
const SVG_HEADERS = {
  ...NO_STORE,
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'none'",
  'Content-Type': 'image/svg+xml',
}

function fail(code: RenderErrorCode): NextResponse {
  return NextResponse.json(
    { error: code, message: RENDER_ERROR_MESSAGE[code] },
    { status: RENDER_ERROR_STATUS[code], headers: HEADERS }
  )
}

function isRendered(v: unknown): v is RenderedDocument {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.kind === 'document') return typeof o.markdown === 'string'
  if (o.kind === 'sheets') return Array.isArray(o.sheets)
  return false
}

async function readCache(path: string): Promise<RenderedDocument | null> {
  try {
    const raw = await downloadObject(path)
    // 함수 응답 한도(4.5MB) 안에서 못 돌려주는 크기면 쓸 수 없는 캐시다 — 다시 변환해 상한 안으로 덜어낸다
    if (raw.length > RENDER_MAX_RESPONSE_BYTES) return null
    const parsed: unknown = JSON.parse(raw.toString('utf8'))
    return isRendered(parsed) ? parsed : null
  } catch (e) {
    if (e instanceof StorageUnconfiguredError) throw e
    // 없음(최초 변환)이거나 읽기 실패 — 어느 쪽이든 다시 변환하면 된다.
    return null
  }
}

/** `?view=layout`(manifest) · `?view=layout&page=<n>`(쪽 SVG). 가드·첨부 확인·형식·크기 검사는 호출 전에 끝나 있다. */
async function layoutResponse(
  userId: string,
  file: RenderSource,
  pageParam: string | null,
  purpose: 'view' | 'thumb'
): Promise<NextResponse> {
  const startedAt = Date.now()
  let page: number | null = null
  if (pageParam !== null) {
    if (!/^[1-9]\d{0,5}$/.test(pageParam)) return jsonError(404, 'Not Found')
    page = Number(pageParam)
  }

  let version: string
  try {
    version = await layoutVersion()
  } catch (e) {
    console.error('[board-work/render] 변환기 로드 실패:', e)
    return fail('server')
  }
  const target = {
    id: file.id,
    name: file.name,
    readOriginal: file.readOriginal,
    version,
    userId,
    purpose,
    startedAt,
  }

  // 쪽 단위 지연 렌더(layout-pages.ts) — manifest 요청은 앞 구간만, 쪽 요청은 그 쪽이 든 구간만 그린다
  try {
    if (page === null) {
      const manifest = await loadLayoutManifest(target)
      return manifest
        ? NextResponse.json(manifest, { headers: HEADERS })
        : jsonError(404, 'Not Found')
    }
    const svg = await loadLayoutPage(target, page)
    if (svg === null) return jsonError(404, 'Not Found')
    return new NextResponse(typeof svg === 'string' ? svg : new Uint8Array(svg), {
      status: 200,
      headers: SVG_HEADERS,
    })
  } catch (e) {
    if (e instanceof LayoutRateLimited) {
      const res = fail('rate_limited')
      res.headers.set('Retry-After', String(e.retryAfterSec))
      return res
    }
    if (e instanceof StorageUnconfiguredError) return jsonError(503, 'Storage Not Configured')
    if (e instanceof RenderError) return fail(e.code)
    console.error('[board-work/render] 레이아웃 처리 중 예외:', e)
    return fail('server')
  }
}

/**
 * `?view=layout`(쪽 목록) · `?view=layout&page=<n>`(쪽 SVG) · `?purpose=thumb`(썸네일 — 변환 횟수를 따로 센다), 그 밖은
 * 변환 결과 JSON.
 */
export async function renderFileResponse(
  request: NextRequest,
  userId: string,
  file: RenderSource
): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const layout = params.get('view') === 'layout'
  // 파일 상세 썸네일은 변환 횟수 제한을 미리보기와 따로 센다(render-guard)
  const purpose = params.get('purpose') === 'thumb' ? 'thumb' : 'view'
  if (!(layout ? isLayoutFile(file.name) : renderFormatOf(file.name))) {
    return fail('unsupported')
  }
  if (file.size > RENDER_MAX_BYTES) return fail('too_large')

  if (layout) return layoutResponse(userId, file, params.get('page'), purpose)

  let version: string
  try {
    version = await converterVersion()
  } catch (e) {
    console.error('[board-work/render] 변환기 로드 실패:', e)
    return fail('server')
  }
  const cachePath = renderCachePath(file.id, version)

  try {
    const cached = await readCache(cachePath)
    if (cached) return NextResponse.json(cached, { headers: HEADERS })
  } catch {
    return jsonError(503, 'Storage Not Configured')
  }

  // 여기서부터는 원본을 내려받아 실제로 변환한다(비싼 경로). 같은 파일의 최근 결정적 실패는 다시 변환하지 않고,
  // 사용자당 분당 횟수를 제한한다(분산 리미터 — render-guard 참조).
  const failureKey = `${file.id}:${version}`
  const remembered = recallRenderFailure(failureKey)
  if (remembered) return fail(remembered)
  const limit = await hitRenderLimit(userId, purpose)
  if (!limit.ok) {
    const res = fail('rate_limited')
    res.headers.set('Retry-After', String('retryAfterSec' in limit ? limit.retryAfterSec : 60))
    return res
  }

  let original: Buffer
  try {
    original = await file.readOriginal()
  } catch (e) {
    if (e instanceof StorageUnconfiguredError) return jsonError(503, 'Storage Not Configured')
    console.error('[board-work/render] 원본 읽기 실패:', e)
    return jsonError(404, 'Not Found')
  }
  // 행의 size 는 승격 때 확인한 값이지만 실제 바이트로 한 번 더 막는다.
  if (original.length > RENDER_MAX_BYTES) return fail('too_large')

  let rendered: RenderedDocument
  try {
    rendered = await convertDocument(original, file.name)
  } catch (e) {
    if (e instanceof RenderError) {
      if (e.code === 'corrupt' || e.code === 'timeout') {
        console.warn(`[board-work/render] ${file.id} 변환 실패(${e.code}):`, e.message)
      }
      rememberRenderFailure(failureKey, e.code)
      return fail(e.code)
    }
    console.error('[board-work/render] 변환 중 예외:', e)
    return fail('server')
  }

  try {
    await uploadBuffer(cachePath, Buffer.from(JSON.stringify(rendered)), 'application/json')
  } catch (e) {
    // 캐시 저장 실패는 응답을 막지 않는다(다음 요청이 다시 변환).
    console.error('[board-work/render] 캐시 저장 실패:', e)
  }
  return NextResponse.json(rendered, { headers: HEADERS })
}
