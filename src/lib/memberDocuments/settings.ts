/**
 * 조합원 내 문서함 기능 스위치 `features/member_documents`(docs/board-work/04-조합원-문서함.md §7).
 *
 * **`enabled === true`일 때만 켜짐**이다(fail-closed). 게시판·댓글 스위치(`@/lib/features/settings`)는 모르면 켜진
 * 것으로 보지만, 문서함은 펀딩·타임뱅크처럼 반대다 — 출시 전 기능이라 행이 없거나 깨지거나 조회가 실패하면 닫힌
 * 채로 있어야 한다. 그리고 **읽기까지** 막는다(꺼지면 목록·미리보기·내려받기도 503).
 */
import { getSystemSettings } from '@/utils/systemSettings'

export const MEMBER_DOCUMENTS_DISABLED_MESSAGE =
  '내 문서함은 아직 준비 중입니다. 사무국(contact@ggac.kr)으로 문의해 주세요.'

/** 저장된 값 → 켜짐 여부. 어떤 값이 와도 던지지 않는다 */
export function normalizeMemberDocumentsEnabled(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  return (raw as Record<string, unknown>).enabled === true
}

export async function isMemberDocumentsEnabled(): Promise<boolean> {
  try {
    const settings = await getSystemSettings()
    return normalizeMemberDocumentsEnabled(settings?.features?.member_documents)
  } catch {
    return false
  }
}
