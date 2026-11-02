import type { Database } from '@work/types/supabase'
import type { PostPolicy } from './post-policy'

type WorkTables = Database['work']['Tables']

export type ChannelRow = WorkTables['channels']['Row']
export type ChannelMemberRow = WorkTables['channel_members']['Row']
export type ChannelKind = Database['work']['Enums']['channel_kind']
export type StaffRole = Database['work']['Enums']['staff_role']

/** 화면이 쓰는 staff 요약(작성자 이름·멘션 후보·멤버 목록) */
export type StaffSummary = {
  user_id: string
  display_name: string
  title: string | null
  role: StaffRole
  status: Database['work']['Enums']['staff_status']
  /** 상태 메시지(0027). 만료는 읽는 쪽이 activeStatus 로 거른다 */
  status_emoji?: string | null
  status_text?: string | null
  status_until?: string | null
}

/** 채널 화면 머리글·정보 패널용 */
export type ChannelDetail = {
  id: string
  kind: ChannelKind
  slug: string | null
  /** DM 은 상대 표시 이름, 그룹은 title 또는 참여자 나열(표시용 — channels.name 이 아니다) */
  name: string
  topic: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  /** 그룹 채팅(kind='dm' + is_group, 0016) */
  isGroup: boolean
  /** 글쓰기 권한(0028). 없으면 everyone */
  postPolicy?: PostPolicy
  /** 그룹에 사용자가 붙인 이름(없으면 null/생략 — name 은 참여자 나열) */
  groupTitle?: string | null
}

/** 현재 사용자의 멤버십(없으면 null — 공개 채널 미리보기) */
export type MyMembership = {
  role: Database['work']['Enums']['channel_member_role']
  last_read_at: string
  muted: boolean
  /** 알림 수준 원본(null=기본: 채널 mentions · DM/그룹 all, 0027) */
  notify_level: string | null
  starred: boolean
}

export type ChannelMemberSummary = {
  user_id: string
  role: Database['work']['Enums']['channel_member_role']
  joined_at: string
}

/** /c 채널 찾아보기 목록 항목 */
export type BrowsableChannel = {
  id: string
  slug: string
  name: string
  kind: ChannelKind
  topic: string | null
  isMember: boolean
}
