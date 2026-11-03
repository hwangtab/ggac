import {
  RENDER_MAX_RESPONSE_BYTES,
  type RenderedDocument,
  type RenderedSheet,
} from './render-types'

/**
 * 변환 결과(JSON)를 함수 응답 한도 안에 가두는 순수 함수들(서버 전용 — Buffer 사용).
 * Vercel 함수 응답은 4.5MB 를 넘으면 실패한다. 상한은 글자 수가 아니라 **직렬화한 JSON 의 UTF-8 바이트**로 센다 —
 * 한글은 3바이트, 줄바꿈·따옴표는 이스케이프로 2바이트가 되므로 글자 수로는 가늠이 안 된다.
 */

/** JSON 문자열 리터럴(따옴표 제외)의 UTF-8 바이트 수 — 이스케이프까지 센 실제 응답 크기 */
function jsonStringBytes(s: string): number {
  return Buffer.byteLength(JSON.stringify(s), 'utf8') - 2
}

/** 직렬화한 JSON 의 바이트 수 */
export function jsonBytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v), 'utf8')
}

/**
 * text 의 앞부분을 JSON 문자열로 직렬화했을 때 maxBytes 이하가 되도록 자른다.
 * 자르는 위치는 글자 경계 — 서로게이트 쌍(이모지 등)을 반으로 가르지 않는다. 안 잘리면 같은 문자열을 돌려준다.
 */
export function clipTextToJsonBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (jsonStringBytes(text) <= maxBytes) return text
  // 글자 하나는 JSON 에서 1바이트 이상이므로 maxBytes 글자 안에 답이 있다. 이분 탐색으로 가장 긴 접두를 찾는다.
  // 끊는 자리가 서로게이트 쌍 한가운데(높은 서로게이트 바로 뒤)면 한 글자 물린다 — 반쪽은 JSON 에서 6바이트
  // 이스케이프가 되어 크기가 단조롭지 않으므로, 탐색 중에도 항상 이 보정을 거친 자리만 잰다.
  const safeCut = (n: number): number => {
    if (n > 0) {
      const c = text.charCodeAt(n - 1)
      if (c >= 0xd800 && c <= 0xdbff) return n - 1
    }
    return n
  }
  let lo = 0
  let hi = Math.min(text.length, maxBytes)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (jsonStringBytes(text.slice(0, safeCut(mid))) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, safeCut(lo))
}

/** 문서 JSON 의 고정 부분(`{"kind":"document","markdown":"","truncated":true}`)과 여유 */
const DOCUMENT_OVERHEAD_BYTES = 128

/** 문서 Markdown → 응답 한도 안의 RenderedDocument. 넘으면 앞부분만 두고 truncated */
export function limitDocument(
  markdown: string,
  maxBytes: number = RENDER_MAX_RESPONSE_BYTES
): RenderedDocument {
  const clipped = clipTextToJsonBytes(markdown, maxBytes - DOCUMENT_OVERHEAD_BYTES)
  return clipped.length < markdown.length
    ? { kind: 'document', markdown: clipped, truncated: true }
    : { kind: 'document', markdown }
}

/** 시트 하나의 고정 부분(이름·키·괄호) 크기 */
function sheetShellBytes(s: RenderedSheet): number {
  return jsonBytes({ ...s, markdown: '', truncated: true, bytesClipped: true }) + 1 // +1 은 구분 쉼표
}

/**
 * 시트 전체 JSON 이 maxBytes 안에 들도록 시트별 내용을 덜어낸다.
 * 뒤 시트를 통째로 버리는 대신 **시트마다 몫을 나눈다**(작은 시트는 그대로, 남은 용량을 큰 시트들이 똑같이 나눠 가짐) —
 * 앞 시트 하나가 용량을 다 쓰면 뒤 시트가 아예 안 보이기 때문이다. 잘린 시트는 `truncated`·`bytesClipped`,
 * 자르는 위치는 줄 경계(표 행이 반쪽으로 남지 않게).
 */
export function fitSheets(
  sheets: RenderedSheet[],
  maxBytes: number = RENDER_MAX_RESPONSE_BYTES
): RenderedSheet[] {
  const wrapper = jsonBytes({ kind: 'sheets', sheets: [] }) + DOCUMENT_OVERHEAD_BYTES
  const sizes = sheets.map(s => jsonBytes(s) + 1)
  if (wrapper + sizes.reduce((a, b) => a + b, 0) <= maxBytes) return sheets

  // 물 채우기: 작은 시트부터 제 크기만큼 주고, 남은 용량을 아직 안 정해진 시트들이 균등하게 나눈다
  const order = sheets.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b])
  const cap = new Array<number>(sheets.length).fill(Infinity)
  let remaining = maxBytes - wrapper
  for (let k = 0; k < order.length; k++) {
    const i = order[k]
    const share = Math.floor(remaining / (order.length - k))
    if (sizes[i] <= share) {
      remaining -= sizes[i]
    } else {
      for (let j = k; j < order.length; j++) cap[order[j]] = share
      break
    }
  }

  return sheets.map((s, i) => {
    if (!Number.isFinite(cap[i])) return s
    const room = cap[i] - sheetShellBytes(s)
    let md = clipTextToJsonBytes(s.markdown, room)
    const nl = md.lastIndexOf('\n')
    if (nl > 0) md = md.slice(0, nl) // 마지막 줄은 잘렸을 수 있어 버린다
    return { ...s, markdown: md, truncated: true, bytesClipped: true }
  })
}
