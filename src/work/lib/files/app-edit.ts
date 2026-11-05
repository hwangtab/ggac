import {
  canOfferHwpEdit,
  getHwpStudioUrl,
  hwpEditFormatOf,
  isHwpFormatEnabled,
  type HwpEditFormat,
} from './hwp-editor'
import { canOfferOfficeEdit, getOfficeEditorOrigin } from './office-edit'

/**
 * 업무툴 밖에서 앱 편집기(ggac-office iframe·rhwp)를 여는 화면들의 공용 판정 — 조합원 내 문서함(04 §8)·이사회 서류 앱 편집
 * (05 §1)이 업무툴과 **같은 env·같은 상한**을 쓰게 한 곳에 둔다:
 * 오피스(DOCX·XLSX·PPTX + 옛 형식)는 `NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`·50MB, HWP 는 거기에 `NEXT_PUBLIC_HWP_EDITOR_ENABLED=1`·
 * 20MB, HWPX 는 또 `NEXT_PUBLIC_HWPX_EDITOR_ENABLED=1`. PC 판정은 화면이 한다. 권한 판정은 하지 않는다(호출부).
 */

export type AppEditorKind =
  | { kind: 'office'; origin: string }
  | { kind: 'hwp'; studioUrl: string; format: HwpEditFormat }

/** 진입점(“앱에서 편집” 단추)을 보일 수 있는 형식·크기인가 */
export function canOfferAppEdit(name: string, size: number): boolean {
  return (
    canOfferOfficeEdit({ fileName: name, size, origin: getOfficeEditorOrigin() }) ||
    canOfferHwpEdit({ fileName: name, size })
  )
}

/** 편집 화면이 열 편집기. 못 열면 화면에 보일 안내 문구 */
export function resolveAppEditor(
  name: string,
  size: number
): { editor: AppEditorKind; message?: undefined } | { editor?: undefined; message: string } {
  const hwpFormat = hwpEditFormatOf(name)
  if (hwpFormat) {
    const studioUrl = getHwpStudioUrl()
    if (!studioUrl || !isHwpFormatEnabled(hwpFormat)) {
      return { message: '이 배포에서는 한글 문서를 앱에서 편집할 수 없습니다.' }
    }
    if (!canOfferHwpEdit({ fileName: name, size })) {
      return { message: '파일이 20MB를 넘어 앱에서 편집할 수 없습니다.' }
    }
    return { editor: { kind: 'hwp', studioUrl, format: hwpFormat } }
  }
  const origin = getOfficeEditorOrigin()
  if (!origin || !canOfferOfficeEdit({ fileName: name, size, origin })) {
    return { message: '이 문서는 앱에서 편집할 수 없는 형식이거나 50MB를 넘습니다.' }
  }
  return { editor: { kind: 'office', origin } }
}
