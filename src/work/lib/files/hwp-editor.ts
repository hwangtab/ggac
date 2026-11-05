import { OFFICE_IFRAME_SANDBOX, getOfficeEditorOrigin } from './office-edit'
import { DOC_EDIT_MAX_BYTES } from './render-types'
import { extensionOf } from './version-rules'

/**
 * HWP·HWPX 앱 안 편집(docs/12·18)의 설정·판정 순수 함수. 편집기는 rhwp-studio(별도 정적 사이트 `/rhwp/`)이고
 * 부모는 `@rhwp/editor` SDK 로 바이트만 주고받는다(URL·토큰·쿠키는 넘기지 않는다).
 */

/** 로드 시간 초과 — SDK 기본(load 60초)과 맞춘다 */
export const HWP_LOAD_TIMEOUT_MS = 60_000
/** 저장(검사·내보내기) 시간 초과 */
export const HWP_SAVE_TIMEOUT_MS = 60_000
/** 변경 여부를 편집기에 묻는 간격 */
export const HWP_DIRTY_POLL_MS = 2_000

/**
 * 편집기 iframe 의 sandbox·referrerPolicy — 오피스 편집기와 같은 수준(docs/11 §1).
 * SDK(`@rhwp/editor` 0.8.7)는 iframe 에 이 속성을 주지 않으므로 `guardEditorIframe` 가 DOM 삽입 전에 건다.
 * allow-top-navigation·allow-forms 는 주지 않는다. (allow 속성 clipboard 는 SDK 가 이미 건다.)
 * **allow-popups 는 준다**(2026-11-05) — 편집기 안 인쇄·PDF 로 인쇄가 미리보기 **새 창**을 연다(rhwp `runPrintPreview`).
 * 없으면 창이 막혀 인쇄가 되지 않는다. 새 창은 이 sandbox 를 그대로 물려받는다(`allow-popups-to-escape-sandbox`는 주지 않는다 —
 * 그 창도 최상위 이동·폼 제출을 못 한다). 오피스 편집기(ONLYOFFICE)는 새 창이 필요 없어 그대로다.
 */
export const HWP_IFRAME_SANDBOX = `${OFFICE_IFRAME_SANDBOX} allow-popups`
export const HWP_IFRAME_REFERRER_POLICY = 'no-referrer'

/**
 * 컨테이너에 iframe 이 붙기 직전(src 는 지정돼도 아직 내비게이션 전)에 sandbox·referrerPolicy 를 건다.
 * SDK 는 `container.appendChild(iframe)` 로만 붙이므로 그 컨테이너 인스턴스의 appendChild 만 잠시 감싼다 —
 * 삽입 뒤에 속성을 바꾸면 첫 내비게이션에는 적용되지 않는다. 돌려주는 함수로 원상 복구한다.
 */
export function guardEditorIframe(container: HTMLElement): () => void {
  const original = container.appendChild.bind(container) as <T extends Node>(node: T) => T
  container.appendChild = (<T extends Node>(node: T): T => {
    if (node instanceof HTMLIFrameElement) {
      node.setAttribute('sandbox', HWP_IFRAME_SANDBOX)
      node.referrerPolicy = HWP_IFRAME_REFERRER_POLICY
    }
    return original(node)
  }) as typeof container.appendChild
  return () => {
    delete (container as { appendChild?: unknown }).appendChild
  }
}

/** HWPX 저장본 MIME — 저장소의 확장자 표(mime.ts)와 같은 값 */
export const HWPX_MIME = 'application/vnd.hancom.hwpx'

/** 편집기가 다루는 형식 */
export type HwpEditFormat = 'hwp' | 'hwpx'

/** 저장 불가 안내(쪽 수 불일치·재로드 실패 등) */
export const HWP_UNSAVABLE_MESSAGE =
  '이 문서는 앱에서 저장하기 어렵습니다 — 내 PC에서 수정을 써 주세요.'

/** OLE2(HWP 5.x) 복합 문서 매직 */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** 기능 켜기: env `NEXT_PUBLIC_HWP_EDITOR_ENABLED=1` 그리고 편집기 출처 env 가 올바를 때만 */
export function isHwpEditorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED === '1' && getOfficeEditorOrigin() !== null
}

/**
 * rhwp-studio 주소 `<편집기 출처>/rhwp/?chrome=embed`. 꺼져 있으면 null.
 *
 * **`chrome=embed`가 꼭 있어야 한다**(2026-11-05 점검). 없으면 rhwp-studio 가 단독 앱(full) 모드로 뜬다:
 * - 시작할 때 자동 복구 대화상자가 편집기 출처의 IndexedDB 에 남은 초안 목록(이름·시각)을 띄운다 — 공용 PC 에서 앞사람이
 *   저장하지 않고 나간 문서가 다음 사람에게 보이고, 복구를 누르면 그 내용이 엉뚱한 문서의 새 버전으로 올라갈 수 있다
 * - Ctrl+S 가 내 PC 로 저장하면서 변경 표시를 지워, 서버에 올리지 않았는데 화면이 "변경 없음"이 된다
 * - 파일 열기·최근 문서·문서 끌어다 놓기로 다른 문서로 바뀌어도 호스트가 모른다
 * embed 프로파일은 이 진입점을 모두 막는다(rhwp-studio `main.ts`의 `chromeMode === 'embed'` 분기).
 */
export function getHwpStudioUrl(): string | null {
  if (!isHwpEditorEnabled()) return null
  const origin = getOfficeEditorOrigin()
  return origin ? `${origin}/rhwp/?chrome=embed` : null
}

/**
 * HWPX 편집 켜기(docs/18 §1): HWP 편집이 켜져 있고(`isHwpEditorEnabled`) **그리고** `NEXT_PUBLIC_HWPX_EDITOR_ENABLED=1`.
 * NEXT_PUBLIC 은 리터럴 접근이라야 클라이언트에 인라인된다.
 */
export function isHwpxEditorEnabled(): boolean {
  return isHwpEditorEnabled() && process.env.NEXT_PUBLIC_HWPX_EDITOR_ENABLED === '1'
}

/** `.hwp`(HWP 5.x) 인가 */
export function isHwpEditFile(fileName: string): boolean {
  return extensionOf(fileName) === 'hwp'
}

/** `.hwpx` 인가 */
export function isHwpxEditFile(fileName: string): boolean {
  return extensionOf(fileName) === 'hwpx'
}

/** 파일 이름의 편집 형식. 앱 편집 대상이 아니면 null (플래그와 무관 — 확장자만) */
export function hwpEditFormatOf(fileName: string): HwpEditFormat | null {
  if (isHwpEditFile(fileName)) return 'hwp'
  if (isHwpxEditFile(fileName)) return 'hwpx'
  return null
}

/** 이 형식의 앱 편집을 켰나 — hwp 는 HWP 플래그, hwpx 는 거기에 HWPX 플래그까지 */
export function isHwpFormatEnabled(format: HwpEditFormat): boolean {
  return format === 'hwpx' ? isHwpxEditorEnabled() : isHwpEditorEnabled()
}

/** 진입점 노출 조건(권한·PC 판정은 호출부) — env·크기(20MB)·확장자(.hwp, .hwpx 는 HWPX 플래그까지) */
export function canOfferHwpEdit(opts: { fileName: string; size: number }): boolean {
  const format = hwpEditFormatOf(opts.fileName)
  return format !== null && isHwpFormatEnabled(format) && opts.size <= DOC_EDIT_MAX_BYTES
}

/** `exportHwpVerify()` 결과 검사. 통과면 null, 막힘이면 안내 문구 */
export function checkHwpVerify(v: unknown): string | null {
  if (!v || typeof v !== 'object') return HWP_UNSAVABLE_MESSAGE
  const o = v as Record<string, unknown>
  if (o.recovered !== true) return HWP_UNSAVABLE_MESSAGE
  if (typeof o.pageCountBefore !== 'number' || typeof o.pageCountAfter !== 'number') {
    return HWP_UNSAVABLE_MESSAGE
  }
  if (o.pageCountBefore !== o.pageCountAfter) return HWP_UNSAVABLE_MESSAGE
  return null
}

// ggac 이식: strict: false 라 ok 판별로 좁혀지지 않는다 — 양쪽에 상대 키를 `?: undefined`로 둔다(ActionResult 와 같은 처리)
export type HwpExportCheck =
  | { ok: true; file: File; error?: undefined }
  | { ok: false; error: string; file?: undefined }

/**
 * `exportHwp()` 바이트 검사: Uint8Array 인가 · 0 < 크기 ≤ 20MB · 매직 `D0 CF 11 E0 A1 B1 1A E1`.
 * 통과하면 이름을 원본 이름 그대로, MIME 은 `application/x-hwp` 로 한 File 을 돌려준다(서버가 다시 형식을 판별한다).
 */
export function checkHwpExport(value: unknown, originalName: string): HwpExportCheck {
  if (!(value instanceof Uint8Array)) {
    return { ok: false, error: '편집기가 올바른 파일을 돌려주지 않았습니다.' }
  }
  if (value.byteLength === 0) return { ok: false, error: '편집기가 빈 파일을 돌려주었습니다.' }
  if (value.byteLength > DOC_EDIT_MAX_BYTES) {
    return { ok: false, error: '저장된 파일이 20MB를 넘어 올릴 수 없습니다.' }
  }
  if (!OLE2_MAGIC.every((b, i) => value[i] === b)) {
    return { ok: false, error: '저장된 파일이 올바른 HWP 형식이 아니어서 올리지 않았습니다.' }
  }
  // 새 ArrayBuffer 로 복사해 SDK 가 쥔 버퍼와 분리한다
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return {
    ok: true,
    file: new File([copy], originalName, {
      type: 'application/x-hwp',
      lastModified: Date.now(),
    }),
  }
}

/** ZIP(HWPX 는 OPC 패키지) 매직 `50 4B 03 04` */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * `exportHwpx()` 바이트 검사: Uint8Array 인가 · 0 < 크기 ≤ 20MB · ZIP 매직. (HWPX 용 쪽 수 재확인 API 가 SDK 에 없어
 * 쪽 수·구조 검증은 서버 verify 가 한다.) 통과하면 이름을 원본 이름 그대로, MIME 은 `application/vnd.hancom.hwpx` 로 한 File.
 */
export function checkHwpxExport(value: unknown, originalName: string): HwpExportCheck {
  if (!(value instanceof Uint8Array)) {
    return { ok: false, error: '편집기가 올바른 파일을 돌려주지 않았습니다.' }
  }
  if (value.byteLength === 0) return { ok: false, error: '편집기가 빈 파일을 돌려주었습니다.' }
  if (value.byteLength > DOC_EDIT_MAX_BYTES) {
    return { ok: false, error: '저장된 파일이 20MB를 넘어 올릴 수 없습니다.' }
  }
  if (!ZIP_MAGIC.every((b, i) => value[i] === b)) {
    return { ok: false, error: '저장된 파일이 올바른 HWPX 형식이 아니어서 올리지 않았습니다.' }
  }
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return {
    ok: true,
    file: new File([copy], originalName, { type: HWPX_MIME, lastModified: Date.now() }),
  }
}
