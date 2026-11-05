import type { ParseResult } from 'kordoc'
import { cleanMarkdown } from './render-document'
import { guardZipBuffer } from './zip-guard'
import { RenderError } from './render-types'

/**
 * 첨부 문서 본문 추출(검색 색인용) — 서버 전용. kordoc(HWP·HWPX·DOCX·XLS·XLSX·PDF → Markdown) 위에
 * 텍스트 파일(txt·md·csv·tsv·log)을 직접 읽는 길을 더하고, 결과를 검색용 평문으로 정리한다.
 *
 * - 뷰어(render-document.ts)와 같은 kordoc 을 쓰되 OCR 은 끈다. PDF 는 kordoc 이 pdfjs-dist(선택 의존성)로 읽는다 —
 *   그래서 이 모듈을 부르는 라우트(`/api/internal/board-work/extract-texts`)는 pdfjs-dist 를 번들에서 빼지 않는다(next.config.js).
 *
 * ggac 이식(원본 kosmart-work `lib/files/extract-text.ts`): 추출 규칙은 그대로다. 저장 상한은 DB CHECK 대신
 * 쓰기 함수(`src/db/queries/work/texts.ts`)가 한 번 더 지킨다(ggac 는 CHECK 를 두지 않는다).
 * - 결과는 평문(표 구분선·마크다운 장식 제거). 화면에는 평문 스니펫만 나가고 raw HTML 은 렌더하지 않는다.
 * - 던지지 않는다: 실패는 상태로 돌려준다(`failed` 는 재시도 대상, 나머지는 확정).
 */

/** 추출 대상 확장자 — 추출 대상 조회(`listPendingExtractionRows`)에도 이 목록을 넘긴다(출처는 여기 하나) */
export const EXTRACT_EXTENSIONS = [
  'hwp',
  'hwpx',
  'docx',
  'xlsx',
  'xls',
  'pdf',
  'txt',
  'md',
  'csv',
  'tsv',
  'log',
] as const

const KORDOC_EXT = new Set(['hwp', 'hwpx', 'docx', 'xlsx', 'xls', 'pdf'])
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'log'])

/** 이보다 큰 원본은 추출하지 않는다(`too_large`) — 뷰어 변환 상한과 같다 */
export const EXTRACT_MAX_BYTES = 50 * 1024 * 1024
/** 저장하는 본문 상한(문자) — 원본 DB check 제약(0029)과 같다(ggac 는 쓰기 함수가 지킨다). 넘으면 앞부분만 두고 truncated */
export const EXTRACT_MAX_CHARS = 2_000_000
/** 파일 하나의 추출 시간 제한(ms) — 동기 CPU 작업 자체는 못 끊으므로 응답만 포기한다 */
export const EXTRACT_TIMEOUT_MS = 60_000
/** 업로드 직후(after) 바로 처리하는 원본 크기 상한 — 이보다 큰 것은 크론이 맡는다 */
export const EXTRACT_INLINE_MAX_BYTES = 10 * 1024 * 1024
/** 본문이 이보다 짧으면 "글자가 없는 문서"(스캔본 등)로 본다 */
export const EXTRACT_MIN_CHARS = 8

export type ExtractStatus = 'ok' | 'unsupported' | 'failed' | 'too_large'

export type ExtractOutcome =
  | { status: 'ok'; content: string; truncated: boolean }
  | { status: 'unsupported' | 'too_large' }
  | { status: 'failed'; reason: string }

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 본문 추출을 시도할 수 있는 파일명인가 */
export function isExtractable(name: string): boolean {
  const ext = extensionOf(name)
  return KORDOC_EXT.has(ext) || TEXT_EXT.has(ext)
}

/** 추출기 버전 — kordoc 버전 + 후처리 규칙 버전(`x1`). 규칙을 바꾸면 올린다. */
export async function extractorVersion(): Promise<string> {
  const { VERSION } = await import('kordoc')
  return `kordoc${VERSION}-x1`
}

/**
 * Markdown(kordoc 출력) → 검색용 평문. 표는 셀을 공백으로 이어 붙이고 구분선 행은 버린다.
 * 제목 `#`·강조 `**`·인용 `>`·그림 자리표시는 뗀다. 연속 공백·빈 줄은 정리한다.
 */
export function toSearchText(markdown: string): string {
  const lines: string[] = []
  for (const raw of cleanMarkdown(markdown).split('\n')) {
    let line = raw.trim()
    if (!line) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) continue // 표 구분선
    if (line.startsWith('|')) line = line.replace(/^\||\|$/g, '').replace(/\|/g, ' ')
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/\*\[그림\]\*/g, ' ')
      .replace(/\*\*|__/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (line) lines.push(line)
  }
  return lines.join('\n').trim()
}

/** 텍스트 파일 디코딩 — UTF-8(BOM 허용)이 깨지면 EUC-KR(옛 한글 txt·csv)로 다시 읽는다. */
export function decodeTextFile(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buffer)
    } catch {
      return buffer.toString('utf8')
    }
  }
}

function clip(text: string): { content: string; truncated: boolean } {
  if (text.length <= EXTRACT_MAX_CHARS) return { content: text, truncated: false }
  return { content: text.slice(0, EXTRACT_MAX_CHARS), truncated: true }
}

/**
 * 저장 전 정리. NUL 은 Postgres text 에 들어가지 않고, 짝 없는 서로게이트(깨진 PDF 글자·자르기 경계)는
 * JSON 본문을 PostgREST 가 "Empty or invalid json" 으로 거절하게 만든다 — 둘 다 걷어낸다.
 * (ggac 이식: SQLite 는 둘 다 받지만 lower()·instr() 검색과 화면 스니펫을 깨뜨리므로 그대로 걷어낸다.)
 */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

function finish(text: string): ExtractOutcome {
  const { content, truncated } = clip(text)
  const clean = cleanExtractedText(content)
  if (clean.replace(/\s/g, '').length < EXTRACT_MIN_CHARS) return { status: 'unsupported' }
  return { status: 'ok', content: clean, truncated }
}

function mapFailure(r: Extract<ParseResult, { success: false }>): ExtractOutcome {
  switch (r.code) {
    case 'UNSUPPORTED_FORMAT':
    case 'ENCRYPTED':
    case 'DRM_PROTECTED':
      return { status: 'unsupported' }
    case 'DECOMPRESSION_BOMB':
    case 'ZIP_BOMB':
    case 'OUTPUT_TOO_LARGE':
      return { status: 'too_large' }
    default:
      return { status: 'failed', reason: `kordoc:${r.code}` }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** 파일 내용에서 검색용 본문을 뽑는다. 절대 던지지 않는다. */
export async function extractText(
  buffer: Buffer,
  name: string,
  opts: { timeoutMs?: number } = {}
): Promise<ExtractOutcome> {
  const ext = extensionOf(name)
  if (buffer.length > EXTRACT_MAX_BYTES) return { status: 'too_large' }

  if (TEXT_EXT.has(ext)) return finish(decodeTextFile(buffer))
  if (!KORDOC_EXT.has(ext)) return { status: 'unsupported' }

  try {
    const work = (async (): Promise<ExtractOutcome> => {
      // zip 계열(docx·xlsx·hwpx)은 kordoc 이 풀기 전에 실제 해제량을 검사한다(압축 폭탄 — 뷰어와 같은 공용 가드)
      await guardZipBuffer(buffer, name)
      const { parse } = await import('kordoc')
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
      // OCR 은 끈다(모델 다운로드·onnxruntime 로드 방지) — 스캔본은 본문 없음(unsupported)으로 남긴다.
      const result = await parse(ab, { ocr: false, tableFormat: 'gfm' })
      // ggac는 strict: false라 `success` 판별 유니온이 좁혀지지 않는다 — 명시 단언(이식 시 수정, render-document.ts와 같다)
      if (!result.success) return mapFailure(result as Extract<ParseResult, { success: false }>)
      return finish(toSearchText((result as Extract<ParseResult, { success: true }>).markdown))
    })()
    return await withTimeout(work, opts.timeoutMs ?? EXTRACT_TIMEOUT_MS)
  } catch (e) {
    if (e instanceof RenderError && e.code === 'too_large') return { status: 'too_large' }
    return { status: 'failed', reason: e instanceof Error ? e.message.slice(0, 200) : 'error' }
  }
}

/** 웹 본문으로 쓸 마크다운 상한(문자) — 검색 본문 상한과 같다. 넘으면 다시 만들지 않는다(지금 본문을 둔다) */
export const BODY_MARKDOWN_MAX_CHARS = EXTRACT_MAX_CHARS

export type MarkdownOutcome =
  | { status: 'ok'; markdown: string }
  | { status: Exclude<ExtractStatus, 'ok'> }

/**
 * 파일 내용 → 웹 본문용 마크다운(이사회 서류 앱 편집이 저장 뒤 `body_markdown`을 다시 만들 때 — 05 §5). 검색 추출
 * (`extractText`)과 같은 kordoc·같은 보호 장치(압축 폭탄 검사·OCR 끔·시간 제한)를 쓰되, 평문으로 줄이지 않고 뷰어와 같은
 * 정리(`cleanMarkdown` — 그림 자리표시·표 칸 줄바꿈)만 한 마크다운을 돌려준다. 텍스트 파일은 그대로. 절대 던지지 않는다.
 */
export async function extractMarkdown(
  buffer: Buffer,
  name: string,
  opts: { timeoutMs?: number } = {}
): Promise<MarkdownOutcome> {
  const ext = extensionOf(name)
  if (buffer.length > EXTRACT_MAX_BYTES) return { status: 'too_large' }
  const done = (md: string): MarkdownOutcome => {
    const clean = cleanExtractedText(md).trim()
    if (clean.replace(/\s/g, '').length < EXTRACT_MIN_CHARS) return { status: 'unsupported' }
    if (clean.length > BODY_MARKDOWN_MAX_CHARS) return { status: 'too_large' }
    return { status: 'ok', markdown: clean }
  }
  if (TEXT_EXT.has(ext)) return done(decodeTextFile(buffer))
  if (!KORDOC_EXT.has(ext)) return { status: 'unsupported' }
  try {
    const work = (async (): Promise<MarkdownOutcome> => {
      await guardZipBuffer(buffer, name)
      const { parse } = await import('kordoc')
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
      const result = await parse(ab, { ocr: false, tableFormat: 'gfm' })
      if (!result.success) {
        const failed = mapFailure(result as Extract<ParseResult, { success: false }>)
        return { status: failed.status as Exclude<ExtractStatus, 'ok'> }
      }
      return done(cleanMarkdown((result as Extract<ParseResult, { success: true }>).markdown))
    })()
    return await withTimeout(work, opts.timeoutMs ?? EXTRACT_TIMEOUT_MS)
  } catch (e) {
    if (e instanceof RenderError && e.code === 'too_large') return { status: 'too_large' }
    return { status: 'failed' }
  }
}
