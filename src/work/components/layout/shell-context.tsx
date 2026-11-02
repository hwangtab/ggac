'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ChannelSort, ChatSort } from '@work/lib/channels/sort'
import type { ChannelCategory } from '@work/lib/channels/sections'
import type { ChannelListItem } from './channel-items'

/** 지출결의(0045) 셸 데이터 — 내 결재 역할과 대기 수. 서브관리자는 없다 */
export type ExpenseShellData = {
  isApprover: boolean
  isPayer: boolean
  counts: { approvalPending: number; paymentPending: number; myUnseen: number }
}

/** 채널 만들기 대화상자의 멤버 후보(활성 staff, 나 제외, 서브관리자는 공동 멤버만 — 서버가 거른 값) */
export type ShellPerson = {
  userId: string
  name: string
  title: string | null
  role?: 'owner' | 'admin' | 'member' | 'guest'
}

/** 카테고리 조작 결과 — 실패 문구는 그대로 화면에 보인다 */
// ggac 이식: `strict: false`에서는 `ok` 판별로 좁혀지지 않아 성공 쪽에도 `error?: undefined`를 둔다(ActionResult와 같은 처리).
export type CategoryOpResult<T extends object = object> =
  | ({ ok: true; error?: undefined } & T)
  | { ok: false; error: string }

/**
 * 채널 카테고리 조작(0044, 업무툴 관리자만 주어진다). 채널 이동·순서는 낙관적으로 먼저 바꾸고 실패하면 되돌린다.
 * 만들기·이름·삭제는 서버 응답을 기다린다.
 */
export type CategoryOps = {
  moveChannel: (item: ChannelListItem, categoryId: string | null) => void
  createCategory: (name: string) => Promise<CategoryOpResult<{ id: string }>>
  renameCategory: (id: string, name: string) => Promise<CategoryOpResult>
  reorderCategories: (ids: string[]) => void
  deleteCategory: (id: string) => Promise<CategoryOpResult>
}

/**
 * 셸이 이미 받은 목록 데이터를 페이지 클라이언트 컴포넌트(홈 리다이렉트·/chat·/c 모바일 목록)에 나눠 준다.
 * 추가 조회 없이 같은 `router.refresh()` 로 갱신된다. Provider 밖(테스트·스토리)에서는 빈 값.
 */
export type ShellData = {
  channels: ChannelListItem[]
  dms: ChannelListItem[]
  isGuest: boolean
  /** 로그인한 사용자 id — 사용자별 임시 저장 표시(DraftMark)에 쓴다 */
  meId?: string
  /** 채널 목록 정렬 방식(0030). 없으면 섹션별 */
  channelSort?: ChannelSort
  /** 정렬 방식 바꾸기(낙관적 갱신 + 저장). 셸 밖에서는 없다 */
  onChannelSortChange?: (sort: ChannelSort) => void
  /** 채팅 목록 정렬 방식(0031). 없으면 최근 활동순 */
  chatSort?: ChatSort
  onChatSortChange?: (sort: ChatSort) => void
  /** 고정/해제(낙관적 갱신 + 저장). 셸 밖에서는 없다 — 없으면 고정 버튼도 그리지 않는다 */
  onTogglePin?: (item: ChannelListItem, next: boolean) => void
  /** 지출결의 역할·대기 수(결재 목록 패널). 서브관리자·셸 밖에서는 없다 */
  expense?: ExpenseShellData
  /** 채널 카테고리(0044, position 순). 셸 밖에서는 없다 */
  categories?: ChannelCategory[]
  /** 업무툴 관리자(owner·admin) — 카테고리 관리·"새 카테고리" 노출 */
  isAdmin?: boolean
  /** 카테고리 관리 조작(관리자만). 없으면 끌어다 놓기·메뉴도 없다 */
  categoryOps?: CategoryOps
  /** 채널 만들기 대화상자의 멤버 후보 */
  people?: ShellPerson[]
}

const EMPTY: ShellData = { channels: [], dms: [], isGuest: false }

const ShellContext = createContext<ShellData>(EMPTY)

export function ShellDataProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShellData(): ShellData {
  return useContext(ShellContext)
}
