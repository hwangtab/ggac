/**
 * 이벤트 참가신청 폼 유형 매핑.
 *
 * `event_applications` 테이블 하나를 여러 행사가 공유하므로, 행사 slug별로
 * 어떤 필드 구성을 쓸지 이 맵에서 결정한다. 폼 컴포넌트(EventApplicationForm),
 * 관리자 조회 페이지가 모두 이 단일 소스를 참조한다.
 *
 * - 'market'   : 사운드마켓류 — 공연 소개·판매 물건·도떼기/옥션 참여·상품 사진
 * - 'workshop' : 워크샵류 — 조합원 여부·신청 동기. 판매/공연 필드 미사용
 */
export type EventFormType = 'market' | 'workshop'

// 기본값은 'market'. 마켓과 다른 구성을 쓰는 행사만 여기에 등록한다.
const EVENT_FORM_TYPES: Record<string, EventFormType> = {
  'home-recording-mixing-workshop': 'workshop',
}

const DEFAULT_FORM_TYPE: EventFormType = 'market'

export function getEventFormType(slug: string): EventFormType {
  return EVENT_FORM_TYPES[slug] ?? DEFAULT_FORM_TYPE
}
