import type { AppTabKind } from './schema'

/** 화면이 쓰는 추가 탭 한 건(work.conversation_tabs 행에서 앱이 다루는 종류만) */
export type ConversationTabItem = {
  id: string
  kind: AppTabKind
  title: string
  position: number
  /** kind 별 설정(parseTabConfig 로 해석). 깨져 있을 수 있다 */
  config: unknown
  createdBy: string
}

/** 탭 바 서버 데이터(직렬화 가능) — 페이지가 읽어 ConversationTabBar 에 내려준다 */
export type TabBarData = {
  /** 추가 탭(게스트에게는 위키 탭이 이미 걸러져 있다) */
  tabs: ConversationTabItem[]
  me: { id: string; isAdmin: boolean; isGuest: boolean }
  /** 이 대화의 멤버인가(공개 채널 미리보기면 false) */
  isMember: boolean
  /** 이 채널의 owner 인가(DM·그룹은 의미 없음) */
  isChannelOwner: boolean
  /** 게스트 멤버가 있는 대화인가 — 위키 탭 추가 시 안내 */
  hasGuests: boolean
  /** 보관된 채널인가 — 업무툴 관리자 외에는 탭·메모를 바꿀 수 없다(0033 restrictive 정책과 같은 규칙) */
  archived?: boolean
}
