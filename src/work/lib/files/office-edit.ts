import { extensionOf } from './version-rules'

/**
 * Word·Excel·PPT 앱 안 편집(docs/11 §2)의 설정·판정 순수 함수.
 * 편집기는 별도 정적 사이트(iframe)이고, 업무툴은 바이트만 주고받는다(URL·토큰·쿠키는 넘기지 않는다).
 */

/** 편집 가능한 파일 크기 상한(50MB) — 편집기 wasm 힙 한도 */
export const OFFICE_EDIT_MAX_BYTES = 50 * 1024 * 1024

/** 편집기 로드(open-buffer → opened) 시간 초과 */
export const OFFICE_LOAD_TIMEOUT_MS = 60_000
/** 저장 요청(save → saved) 시간 초과. 넘으면 오류로 둔다(원본을 잘못 올리지 않게) */
export const OFFICE_SAVE_TIMEOUT_MS = 60_000
/** 로그아웃 때 purge.html 을 기다리는 최대 시간 */
export const OFFICE_PURGE_WAIT_MS = 3_000

/** 편집기 iframe 의 sandbox — allow-top-navigation·allow-popups-to-escape-sandbox·allow-forms 는 금지(PoC 결과로만 늘린다) */
export const OFFICE_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-downloads allow-modals'
export const OFFICE_IFRAME_ALLOW = 'clipboard-read; clipboard-write'

/** 열 수 있는 확장자 → 저장 확장자(옛 형식은 OOXML 로 저장된다) */
const SAVE_EXT: Record<string, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  doc: 'docx',
  xls: 'xlsx',
  ppt: 'pptx',
}

const MIME_BY_EXT: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * 편집기 출처. env `NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN` 이 없거나 올바르지 않으면 null — 기능 전체를 숨긴다.
 * https 이거나 로컬 개발(localhost)의 http 만 허용하고 경로·끝 슬래시는 버린다(출처만 비교한다).
 */
export function getOfficeEditorOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin
  } catch {
    // 잘못된 주소
  }
  return null
}

/** docx·xlsx·pptx(+옛 doc·xls·ppt) 인가 */
export function isOfficeEditFile(fileName: string): boolean {
  return extensionOf(fileName) in SAVE_EXT
}

/** 저장될 확장자(옛 형식은 OOXML). 대상이 아니면 null */
export function officeSaveExtension(fileName: string): string | null {
  return SAVE_EXT[extensionOf(fileName)] ?? null
}

/** 저장하면 확장자가 바뀌는가(doc→docx 등) — 1단계 규칙대로 확인을 받는다 */
export function officeExtensionWillChange(fileName: string): boolean {
  const ext = extensionOf(fileName)
  return ext in SAVE_EXT && SAVE_EXT[ext] !== ext
}

/** 새 버전 이름: 원본 이름에서 확장자만 저장 확장자로 */
export function officeSavedName(fileName: string): string {
  const ext = officeSaveExtension(fileName)
  if (!ext) return fileName
  const i = fileName.lastIndexOf('.')
  const stem = i > 0 ? fileName.slice(0, i) : fileName
  return `${stem}.${ext}`
}

/** 저장 파일의 MIME — 편집기가 알려 주는 값을 믿지 않고 원본 확장자 기준으로 정한다 */
export function officeMimeFor(fileName: string): string {
  const ext = officeSaveExtension(fileName)
  return ext ? MIME_BY_EXT[ext] : 'application/octet-stream'
}

/** 진입점 노출 조건(권한 판정은 호출부) — env·크기·확장자 */
export function canOfferOfficeEdit(opts: {
  fileName: string
  size: number
  origin: string | null
}): boolean {
  return (
    opts.origin !== null && isOfficeEditFile(opts.fileName) && opts.size <= OFFICE_EDIT_MAX_BYTES
  )
}

/** iframe 주소 — 출처가 달라도 부모 출처를 알려 줘야 편집기가 메시지를 돌려보낸다 */
export function officeEditorSrc(origin: string, parentOrigin: string): string {
  const q = new URLSearchParams({ embed: '1', embedOrigin: parentOrigin })
  return `${origin}/editor?${q.toString()}`
}

/** 저장 파일 검사 결과 */
export type SavedFileCheck = { ok: true; file: File } | { ok: false; error: string }

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * 편집기가 돌려준 파일을 올리기 전에 검사한다: Blob 인가 · 0 < 크기 ≤ 상한 · 확장자(원본 또는 OOXML 대응) · 매직 바이트 `PK\x03\x04`.
 * 통과하면 이름·MIME 을 원본 기준으로 정리한 File 을 돌려준다.
 */
export async function checkSavedOfficeFile(
  value: unknown,
  originalName: string
): Promise<SavedFileCheck> {
  if (!(value instanceof Blob)) {
    return { ok: false, error: '편집기가 올바른 파일을 돌려주지 않았습니다.' }
  }
  if (value.size === 0) return { ok: false, error: '편집기가 빈 파일을 돌려주었습니다.' }
  if (value.size > OFFICE_EDIT_MAX_BYTES) {
    return { ok: false, error: '저장된 파일이 50MB를 넘어 올릴 수 없습니다.' }
  }
  const rawName = value instanceof File ? value.name : ''
  const gotExt = extensionOf(rawName)
  const origExt = extensionOf(originalName)
  const wantExt = officeSaveExtension(originalName)
  if (!wantExt || (gotExt !== origExt && gotExt !== wantExt)) {
    return { ok: false, error: '저장된 파일의 형식이 원본과 맞지 않아 올리지 않았습니다.' }
  }
  const head = new Uint8Array(await readBytes(value.slice(0, 4)))
  if (!ZIP_MAGIC.every((b, i) => head[i] === b)) {
    return { ok: false, error: '저장된 파일이 올바른 문서 형식이 아니어서 올리지 않았습니다.' }
  }
  return {
    ok: true,
    file: new File([value], officeSavedName(originalName), {
      type: officeMimeFor(originalName),
      lastModified: Date.now(),
    }),
  }
}

/** Blob.arrayBuffer 가 없는 환경(jsdom)도 읽도록 FileReader 로 대체 */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}
