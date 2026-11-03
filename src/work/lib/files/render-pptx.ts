import JSZip from 'jszip'
import { ZIP_MAX_ENTRIES, readZipText } from './zip-guard'
import { PPTX_MAX_SLIDES, PPTX_MAX_UNCOMPRESSED_BYTES, RenderError } from './render-types'

/**
 * PPTX → Markdown. kordoc 이 PPTX 를 지원하지 않아 직접 만든다. 서버 전용(Route Handler 에서만 import).
 *
 * - 슬라이드마다 `## 슬라이드 N` + 문단(`<a:p>` 단위, `<a:t>` 이어붙임, 빈 문단 제외).
 * - 슬라이드 순서·포함 여부는 `ppt/presentation.xml` 의 `p:sldIdLst` + `ppt/_rels/presentation.xml.rels` 로 정한다
 *   (목록에 없는 고아 슬라이드 제외, 표시 번호는 목록 순서). 둘 중 하나가 없거나 깨졌으면 파일명 번호순으로 폴백.
 * - 표(`a:tbl`)는 GFM 표. 발표자 노트는 `> 메모: …` 인용.
 * - 그림·도형 서식·애니메이션·매크로는 읽지 않는다(텍스트와 표만).
 * - 압축 폭탄 대비: 슬라이드 수·압축 해제 총량 상한(render-types).
 */

export type PptxBlock = { type: 'p'; text: string } | { type: 'table'; rows: string[][] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML 엔티티(&amp; 등과 숫자 참조) 해제 */
export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      } catch {
        return m
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * 토큰: 주석 · CDATA(1) · 태그(2 닫는 `/`, 3 이름, 4 속성, 5 자기닫힘 `/`).
 * 속성값 안의 `>` 는 태그를 끝내지 않는다(따옴표 안은 통째로 소비).
 */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)(?:[A-Za-z0-9_.-]+:)?([A-Za-z0-9_]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

/**
 * 슬라이드·노트 XML 에서 문단·표를 문서 순서대로 뽑는 가벼운 토크나이저.
 * 태그 이름만 보고(접두사 무시) a:p / a:t / a:br / a:fld / a:tbl / a:tr / a:tc 를 처리한다.
 * - 주석(`<!-- -->`)은 건너뛰고, CDATA 는 풀어 본문으로 읽는다(그 안의 `<…>` 는 태그가 아니다).
 * - 자기닫힘 `<a:tc/>` 는 빈 셀(열이 밀리지 않게).
 * - `mc:AlternateContent` 는 첫 `mc:Choice` 만 읽고 `mc:Fallback`(같은 내용의 대체 표현)은 건너뛴다.
 */
export function extractBlocks(xml: string): PptxBlock[] {
  const blocks: PptxBlock[] = []
  const tagRe = new RegExp(TOKEN_RE.source, 'g')
  let tableRows: string[][] | null = null
  let row: string[] | null = null
  let cell: string[] | null = null
  let para: string | null = null
  let inText = false
  let fld = 0
  let last = 0
  // mc:AlternateContent 스택 — alt(첫 Choice 를 봤는지) / take(읽는 Choice) / skip(건너뛰는 Choice·Fallback)
  const mc: Array<{ kind: 'alt'; choiceSeen: boolean } | { kind: 'take' } | { kind: 'skip' }> = []
  let skip = 0

  const openSkip = () => {
    mc.push({ kind: 'skip' })
    skip++
  }

  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    // 이 토큰 앞의 글(<a:t> 안일 때만 본문)
    if (inText && para !== null && fld === 0 && skip === 0 && m.index > last) {
      para += decodeXmlEntities(xml.slice(last, m.index))
    }
    last = tagRe.lastIndex

    if (m[0].startsWith('<!--')) continue // 주석 — <a:t> 안에 있어도 글을 끊지 않는다
    if (m[1] !== undefined) {
      // CDATA — 엔티티 해제 없이 그대로 본문
      if (inText && para !== null && fld === 0 && skip === 0) para += m[1]
      continue
    }

    const closing = m[2] === '/'
    const selfClose = m[5] === '/'
    const name = m[3]
    inText = false

    // mc:AlternateContent 는 건너뛰는 중에도 짝을 맞춰야 한다
    if (name === 'AlternateContent') {
      if (!closing && !selfClose) mc.push({ kind: 'alt', choiceSeen: false })
      else if (closing) {
        while (mc.length > 0) {
          const top = mc.pop()
          if (top?.kind === 'alt') break
          if (top?.kind === 'skip') skip--
        }
      }
      continue
    }
    if (name === 'Choice' || name === 'Fallback') {
      if (!closing && !selfClose) {
        if (name === 'Fallback') {
          openSkip()
        } else {
          const alt = [...mc].reverse().find(e => e.kind === 'alt')
          if (alt && alt.kind === 'alt' && !alt.choiceSeen) {
            alt.choiceSeen = true
            mc.push({ kind: 'take' })
          } else if (alt) {
            openSkip()
          } else {
            mc.push({ kind: 'take' }) // AlternateContent 밖의 Choice — 평범한 태그
          }
        }
      } else if (closing) {
        const top = mc.pop()
        if (top?.kind === 'skip') skip--
      }
      continue
    }
    if (skip > 0) continue

    switch (name) {
      case 'tbl':
        if (!closing && !tableRows) tableRows = []
        else if (closing && tableRows) {
          if (tableRows.length > 0) blocks.push({ type: 'table', rows: tableRows })
          tableRows = null
        }
        break
      case 'tr':
        if (tableRows) {
          if (!closing) row = []
          else if (row) {
            tableRows.push(row)
            row = null
          }
        }
        break
      case 'tc':
        if (row) {
          if (!closing && !selfClose) cell = []
          else if (!closing && selfClose)
            row.push('') // <a:tc/> — 빈 셀
          else if (closing && cell) {
            row.push(cell.join(' ').trim())
            cell = null
          }
        }
        break
      case 'p':
        if (closing) {
          const text = (para ?? '').replace(/\s+/g, ' ').trim()
          para = null
          if (text) {
            if (cell) cell.push(text)
            else if (!tableRows) blocks.push({ type: 'p', text })
          }
        } else if (!selfClose) {
          para = ''
        }
        break
      case 'br':
        if (!closing && para !== null) para += ' '
        break
      case 'fld':
        // 슬라이드 번호·날짜 필드 — 본문이 아니다
        if (!closing && !selfClose) fld++
        else if (closing && fld > 0) fld--
        break
      case 't':
        if (!closing && !selfClose) inText = true
        break
      default:
        break
    }
  }
  return blocks
}

function escapeLine(text: string): string {
  // 줄머리의 마크다운 문법(제목·인용·목록)이 되지 않게 한다
  return text.replace(/^([#>+-]|\d+[.)])(?=\s|$|[#>])/, '\\$1')
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function tableToMarkdown(rows: string[][]): string {
  const width = Math.max(...rows.map(r => r.length))
  if (!(width > 0)) return ''
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => escapeCell(r[i] ?? ''))
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
  const [head, ...rest] = rows
  return [line(head), `| ${Array(width).fill('---').join(' | ')} |`, ...rest.map(line)].join('\n')
}

function blocksToMarkdown(blocks: PptxBlock[]): string {
  return blocks
    .map(b => (b.type === 'p' ? escapeLine(b.text) : tableToMarkdown(b.rows)))
    .filter(Boolean)
    .join('\n\n')
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0)
}

/** 태그 속성 문자열 → 이름/값(큰따옴표·작은따옴표 모두). 같은 이름이 또 나오면 앞의 것을 둔다 */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z0-9_.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (!(m[1] in out)) out[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '')
  }
  return out
}

/** 관계 Target(`slides/slide1.xml`·`../x`·`/ppt/slides/slide1.xml`)을 zip 안 절대 경로로 */
function resolveTarget(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

/**
 * `presentation.xml` 의 `p:sldIdLst`(r:id 순서)와 `presentation.xml.rels`(r:id → slide 파일)로 슬라이드 경로를 순서대로 구한다.
 * 목록이 없거나 하나도 풀리지 않으면(파일 없음·깨짐) null — 호출자가 파일명 순으로 폴백한다.
 * 목록에 있는데 파일이 없는 항목은 건너뛴다.
 */
export function slideOrderFromPresentation(
  presentationXml: string | null,
  relsXml: string | null,
  exists: (path: string) => boolean
): string[] | null {
  if (!presentationXml || !relsXml) return null
  const list =
    /<(?:[A-Za-z0-9_.-]+:)?sldIdLst\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?sldIdLst\s*>/.exec(
      presentationXml.replace(/<!--[\s\S]*?-->/g, '')
    )
  if (!list) return null

  const rels = new Map<string, string>()
  const relRe = /<(?:[A-Za-z0-9_.-]+:)?Relationship\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g
  let rm: RegExpExecArray | null
  while ((rm = relRe.exec(relsXml.replace(/<!--[\s\S]*?-->/g, '')))) {
    const a = parseAttrs(rm[1])
    if (!a.Id || !a.Target || !/\/relationships\/slide$/.test(a.Type ?? '')) continue
    rels.set(a.Id, resolveTarget('ppt', a.Target))
  }

  const out: string[] = []
  const seen = new Set<string>()
  const idRe = /<(?:[A-Za-z0-9_.-]+:)?sldId\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g
  let im: RegExpExecArray | null
  while ((im = idRe.exec(list[1]))) {
    const a = parseAttrs(im[1])
    const rid = Object.entries(a).find(([k]) => /^[A-Za-z0-9_.-]+:id$/.test(k))?.[1]
    const path = rid ? rels.get(rid) : undefined
    if (!path || seen.has(path) || !exists(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out.length > 0 ? out : null
}

/** zip 이 아닌데 OLE 컨테이너(D0CF11E0)면 암호가 걸린 Office 문서다. */
function isOleContainer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0
}

/** 슬라이드 파일의 관계 파일 경로(`ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels`) */
function relsPathOf(slidePath: string): string {
  const i = slidePath.lastIndexOf('/')
  return `${slidePath.slice(0, i)}/_rels/${slidePath.slice(i + 1)}.rels`
}

export async function pptxToMarkdown(
  buffer: Buffer,
  opts: { maxBytes?: number } = {}
): Promise<string> {
  const maxBytes = opts.maxBytes ?? PPTX_MAX_UNCOMPRESSED_BYTES
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new RenderError(isOleContainer(buffer) ? 'encrypted' : 'corrupt')
  }

  // 읽지 않는 항목(미디어 등)이 폭탄이어도 메모리에 올리지 않지만, 항목 수 폭주는 미리 막는다
  if (Object.keys(zip.files).length > ZIP_MAX_ENTRIES) throw new RenderError('too_large')

  // 압축 해제 총량은 zip 헤더(속일 수 있음)가 아니라 **실제로 푼 바이트**로 센다 — 항목을 스트리밍으로 풀다가
  // 항목당(ZIP_MAX_TEXT_ENTRY_BYTES)·총량(maxBytes) 상한에서 멈춘다(zip-guard).
  let total = 0
  const read = async (path: string): Promise<string | null> => {
    const file = zip.file(path)
    if (!file) return null
    const { text, bytes } = await readZipText(file, maxBytes - total)
    total += bytes
    return text
  }

  const out: string[] = []
  try {
    // 슬라이드 목록: presentation.xml 의 순서·포함 여부가 우선, 안 되면 파일명 번호순(표시 번호도 파일 번호)
    const ordered = slideOrderFromPresentation(
      await read('ppt/presentation.xml'),
      await read('ppt/_rels/presentation.xml.rels'),
      p => zip.file(p) !== null
    )
    const slides: Array<{ path: string; n: number }> = ordered
      ? ordered.map((path, i) => ({ path, n: i + 1 }))
      : Object.keys(zip.files)
          .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort((a, b) => slideNumber(a) - slideNumber(b))
          .map(path => ({ path, n: slideNumber(path) }))
    if (slides.length === 0) throw new RenderError('corrupt')
    if (slides.length > PPTX_MAX_SLIDES) throw new RenderError('too_large')

    for (const { path, n } of slides) {
      const xml = await read(path)
      if (xml === null) continue
      const parts = [`## 슬라이드 ${n}`]
      const body = blocksToMarkdown(extractBlocks(xml))
      if (body) parts.push(body)

      const rels = await read(relsPathOf(path))
      const notePath = rels
        ? /Target\s*=\s*(["'])(?:\.\.\/|\/ppt\/)notesSlides\/(notesSlide\d+\.xml)\1/.exec(rels)?.[2]
        : undefined
      if (notePath) {
        const noteXml = await read(`ppt/notesSlides/${notePath}`)
        const note = noteXml
          ? extractBlocks(noteXml)
              .filter((b): b is Extract<PptxBlock, { type: 'p' }> => b.type === 'p')
              .map(b => b.text)
              .join(' ')
          : ''
        if (note) parts.push(`> 메모: ${note}`)
      }
      out.push(parts.join('\n\n'))
    }
  } catch (e) {
    if (e instanceof RenderError) throw e
    throw new RenderError('corrupt', e instanceof Error ? e.message : String(e))
  }
  return out.join('\n\n')
}
