import { canOfferHwpEdit, isHwpxEditorEnabled } from '@work/lib/files/hwp-editor'
import { canOfferOfficeEdit, getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import { MEMBER_NEW_DOCUMENT_TYPES, type MemberNewDocumentType } from './rules'

/**
 * 문서함에서 편집기를 내보일지 — 업무툴과 **같은 env·같은 판정**을 쓴다(docs/board-work/04-조합원-문서함.md §8·§9):
 * 오피스는 `NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`, HWP 는 거기에 `NEXT_PUBLIC_HWP_EDITOR_ENABLED=1`, HWPX 는 또
 * `NEXT_PUBLIC_HWPX_EDITOR_ENABLED=1`. 크기 상한도 같다(오피스 50MB·HWP 20MB). PC 판정은 화면이 한다.
 */
export function canEditMemberDocument(name: string, size: number): boolean {
  return (
    canOfferOfficeEdit({ fileName: name, size, origin: getOfficeEditorOrigin() }) ||
    canOfferHwpEdit({ fileName: name, size })
  )
}

/** 지금 배포에서 만들 수 있는 새 문서 형식 */
export function availableNewDocumentTypes(): { type: MemberNewDocumentType; label: string }[] {
  const office = getOfficeEditorOrigin() !== null
  const hwpx = isHwpxEditorEnabled()
  return MEMBER_NEW_DOCUMENT_TYPES.filter(t => (t.type === 'hwpx' ? hwpx : office)).map(t => ({
    type: t.type,
    label: t.label,
  }))
}
