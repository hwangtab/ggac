import type { IRBlock, ParseResult } from 'kordoc'
import { pptxToMarkdown } from './render-pptx'
import { fitSheets, limitDocument } from './render-size'
import { guardZipBuffer } from './zip-guard'
import {
  RENDER_TIMEOUT_MS,
  RenderError,
  SHEET_MAX_COUNT,
  SHEET_MAX_ROWS,
  type RenderedDocument,
  type RenderedSheet,
} from './render-types'

/**
 * kordoc(HWP·HWPX·HWPML·DOCX·XLS·XLSX → Markdown) + PPTX(render-pptx, 직접 구현) 래퍼. 서버 전용(Route Handler 에서만 import).
 *
 * - 문서: Markdown 한 덩이. 표는 `tableFormat: 'gfm'`(HTML 표 금지 — 화면이 raw HTML 을 렌더하지 않는다).
 * - 시트: 시트 한 장 = kordoc 의 "쪽" 하나. 시트 이름은 쪽의 첫 heading 블록, 행은 SHEET_MAX_ROWS 까지.
 * - 매크로·스크립트는 변환기가 읽지 않는다(텍스트·표·이미지 자리만 추출).
 */

export type RenderFormat = 'document' | 'sheets'

const DOC_EXT = new Set(['hwp', 'hwpx', 'hml', 'docx', 'pptx'])
const SHEET_EXT = new Set(['xlsx', 'xls'])

/** 확장자로 변환 방식을 정한다. 지원하지 않으면 null. */
export function renderFormatOf(name: string): RenderFormat | null {
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  if (DOC_EXT.has(ext)) return 'document'
  if (SHEET_EXT.has(ext)) return 'sheets'
  return null
}

/** 변환기 버전 — 캐시 키에 들어간다(kordoc 을 올리면 자동으로 캐시가 갈린다). `r3` 는 후처리 규칙 버전(r3: 응답 바이트 상한). */
export async function converterVersion(): Promise<string> {
  const { VERSION } = await import('kordoc')
  return `kordoc${VERSION}-r3`
}

/** 변환 후처리: 그림 문법(파일명/데이터 URI)은 자리 표시로, 표 셀 안 `<br>` 는 구분자로. */
export function cleanMarkdown(md: string): string {
  return md
    .split('\n')
    .map(line => {
      let out = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '*[그림]*')
      if (out.trimStart().startsWith('|')) out = out.replace(/<br\s*\/?>/gi, ' / ')
      return out
    })
    .join('\n')
}

function failureToError(r: Extract<ParseResult, { success: false }>): RenderError {
  switch (r.code) {
    case 'UNSUPPORTED_FORMAT':
      return new RenderError('unsupported')
    case 'ENCRYPTED':
    case 'DRM_PROTECTED':
      return new RenderError('encrypted')
    case 'DECOMPRESSION_BOMB':
    case 'ZIP_BOMB':
    case 'OUTPUT_TOO_LARGE':
      return new RenderError('too_large')
    default:
      return new RenderError('corrupt', r.error)
  }
}

/** 표 블록을 앞 max 행으로 자른다. 잘렸으면 truncated. */
function clipTable(block: IRBlock, maxRows: number): { block: IRBlock; truncated: boolean } {
  const t = block.table
  if (!t || t.cells.length <= maxRows) return { block, truncated: false }
  const cells = t.cells
    .slice(0, maxRows)
    .map((row, r) => row.map(c => ({ ...c, rowSpan: Math.min(c.rowSpan, maxRows - r) })))
  return { block: { ...block, table: { ...t, rows: maxRows, cells } }, truncated: true }
}

/** kordoc 블록(시트 = 쪽 하나)을 시트별 Markdown 으로. 행은 maxRows 까지만. */
export async function toSheets(
  blocks: IRBlock[],
  maxRows = SHEET_MAX_ROWS
): Promise<RenderedSheet[]> {
  const { blocksToMarkdown } = await import('kordoc')
  const pages = new Map<number, IRBlock[]>()
  for (const b of blocks) {
    const n = b.pageNumber ?? 1
    const list = pages.get(n)
    if (list) list.push(b)
    else pages.set(n, [b])
  }
  const sheets: RenderedSheet[] = []
  for (const [n, list] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    if (sheets.length >= SHEET_MAX_COUNT) break
    const heading = list.find(b => b.type === 'heading' && b.text)
    const body = list.filter(b => b !== heading)
    let truncated = false
    let remaining = maxRows
    const clipped: IRBlock[] = []
    for (const b of body) {
      if (b.type === 'table' && b.table) {
        if (remaining <= 0) {
          truncated = true
          continue
        }
        const c = clipTable(b, remaining)
        remaining -= c.block.table?.rows ?? 0
        truncated ||= c.truncated
        clipped.push(c.block)
      } else {
        clipped.push(b)
      }
    }
    sheets.push({
      name: heading?.text?.trim() || `시트 ${n}`,
      markdown: cleanMarkdown(blocksToMarkdown(clipped, { tableFormat: 'gfm' })),
      truncated,
    })
  }
  return sheets
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderError('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 파일 내용을 뷰어용 JSON 으로 바꾼다. 실패는 RenderError(코드)로 던진다.
 * 타임아웃은 응답을 끊어 줄 뿐 동기 CPU 작업 자체를 중단하지는 못한다 — 그래서 원본 크기 상한을 따로 둔다.
 */
export async function convertDocument(
  buffer: Buffer,
  name: string,
  opts: { timeoutMs?: number; maxRows?: number; maxBytes?: number } = {}
): Promise<RenderedDocument> {
  const format = renderFormatOf(name)
  if (!format) throw new RenderError('unsupported')

  const work = (async (): Promise<RenderedDocument> => {
    if (/\.pptx$/i.test(name)) {
      return limitDocument(cleanMarkdown(await pptxToMarkdown(buffer)).trim(), opts.maxBytes)
    }
    // zip 계열(docx·xlsx·hwpx)은 kordoc 이 풀기 전에 실제 해제량을 검사한다(압축 폭탄 — 헤더 크기는 속일 수 있다)
    await guardZipBuffer(buffer, name)
    const { parse } = await import('kordoc')
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
    let result: ParseResult
    try {
      // OCR 은 끈다(모델 다운로드·onnxruntime 로드 방지) — 이 뷰어는 텍스트 문서만 다룬다.
      result = await parse(ab, { ocr: false, tableFormat: 'gfm' })
    } catch (e) {
      throw new RenderError('corrupt', e instanceof Error ? e.message : String(e))
    }
    // ggac는 strict: false라 `success` 판별 유니온이 좁혀지지 않는다 — 명시 단언(이식 시 수정)
    if (!result.success) throw failureToError(result as Extract<ParseResult, { success: false }>)

    if (format === 'sheets') {
      // 시트 합계가 응답 한도(RENDER_MAX_RESPONSE_BYTES)를 넘으면 시트별 몫으로 덜어낸다
      return {
        kind: 'sheets',
        sheets: fitSheets(await toSheets(result.blocks, opts.maxRows), opts.maxBytes),
      }
    }
    return limitDocument(cleanMarkdown(result.markdown).trim(), opts.maxBytes)
  })()

  return withTimeout(work, opts.timeoutMs ?? RENDER_TIMEOUT_MS)
}
