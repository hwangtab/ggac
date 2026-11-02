import type { Database } from '@work/types/supabase'

export type ChannelKind = Database['work']['Enums']['channel_kind']

/**
 * 사이드바 채널 항목 — 메시징 영역이 이 모양으로 데이터를 채운다(브리프 §8).
 * - slug: public/private 은 필수, dm 은 null(경로는 /dm/<id>)
 * - name: dm 은 상대 표시 이름
 * - unread: 읽지 않은 메시지 수(0 이면 없음)
 * - mentions: 읽지 않은 멘션 수(선택, 배지로 표시)
 * - group: 그룹 채팅(kind='dm' 이면서 3명 이상, 선택 — 아이콘만 다르다)
 * - online: 1:1 DM 상대가 접속 중인가(선택, 0020 — 그룹·채널은 표시하지 않는다)
 * - statusEmoji/statusText: 1:1 DM 상대의 상태 메시지(선택, 0027 — 서버가 만료를 거른 값)
 */
export type ChannelListItem = {
  id: string
  slug: string | null
  name: string
  kind: ChannelKind
  unread: number
  starred: boolean
  mentions?: number
  muted?: boolean
  /** 채널 카테고리 id(0044, 채널만 — null·없음은 "기타") */
  categoryId?: string | null
  group?: boolean
  /** 마지막 메시지 시각(ms, 0030) — 최근 활동순 정렬용. 없으면 활동 없음 */
  lastActivityAt?: number
  online?: boolean
  statusEmoji?: string | null
  statusText?: string | null
}

/**
 * ggac 이식: 업무툴은 `/board-room` 아래에 있다(설계 §2-1). 원본은 루트(`/c/…`·`/dm/…`)였다.
 * 로케일 접두사는 붙이지 않는다 — 기본 로케일(ko)은 접두사가 없고, 업무툴 화면은 한국어 고정이다.
 */
export const WORK_BASE_PATH = '/board-room'

export function channelHref(item: Pick<ChannelListItem, 'id' | 'slug' | 'kind'>): string {
  if (item.kind === 'dm' || !item.slug) return `${WORK_BASE_PATH}/dm/${item.id}`
  return `${WORK_BASE_PATH}/c/${encodeURIComponent(item.slug)}`
}
