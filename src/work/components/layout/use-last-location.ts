'use client'

import { useEffect } from 'react'
import { activeSection, mainSections, sectionByKey, type NavSection } from './nav-sections'
import { channelHref, type ChannelListItem } from './channel-items'

/**
 * "마지막으로 본 곳" — 레일 클릭과 홈(`/`) 리다이렉트가 쓴다(설계 03 §2-2·§2-3).
 * 저장소는 localStorage(경로 문자열). 사생활 보호 모드·차단 환경에서는 예외가 나므로 모두 try/catch 로 감싸고,
 * 실패하면 "기록 없음"으로 본다. SSR 에서는 아무것도 하지 않는다.
 */
export const LAST_SECTION_KEY = 'kw-last-section'
export const LAST_DM_KEY = 'kw-last-dm'
export const LAST_CHANNEL_KEY = 'kw-last-channel'

type ItemRef = Pick<ChannelListItem, 'id' | 'slug' | 'kind'>

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    // 저장 불가 환경 — 기록만 포기한다
  }
}

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/** pathname 변화를 기록한다. 관리(/admin)·검색·설정 등 레일 밖 경로는 기록하지 않는다. */
export function recordLocation(pathname: string): void {
  const section = activeSection(pathname)
  if (!section || section === 'admin') return
  write(LAST_SECTION_KEY, section)
  if (pathname.startsWith('/dm/')) write(LAST_DM_KEY, pathname)
  else if (pathname.startsWith('/c/')) write(LAST_CHANNEL_KEY, pathname)
}

/** 앱 셸에서 한 번 부른다 — 경로가 바뀔 때마다 기록 */
export function useLastLocation(pathname: string): void {
  useEffect(() => {
    recordLocation(pathname)
  }, [pathname])
}

/** 저장된 경로가 지금 내 목록에 있는 대화이면 그 경로(나간 채널은 무시) */
function validStored(key: string, items: ItemRef[], dm: boolean): string | null {
  const stored = read(key)
  if (!stored) return null
  const target = safeDecode(stored)
  const hit = items.some(i => (i.kind === 'dm') === dm && safeDecode(channelHref(i)) === target)
  return hit ? stored : null
}

/**
 * 레일 항목을 눌렀을 때 갈 곳: 채팅·채널은 마지막으로 본 대화(목록에 없으면 섹션 루트), 나머지는 섹션 루트.
 * items 는 내가 멤버인 채널·DM.
 */
export function resolveSectionHref(section: NavSection, items: ItemRef[]): string {
  if (section.key === 'chat') return validStored(LAST_DM_KEY, items, true) ?? section.href
  if (section.key === 'channels') return validStored(LAST_CHANNEL_KEY, items, false) ?? section.href
  return section.href
}

/** 홈 진입 시 이동할 곳. 기록이 없거나 쓸 수 없는 섹션(게스트의 자료실 등)이면 null → 빈 상태를 그린다. */
export function homeRedirectTarget({
  items,
  isGuest,
}: {
  items: ItemRef[]
  isGuest: boolean
}): string | null {
  const key = read(LAST_SECTION_KEY)
  if (!key) return null
  const section = mainSections({ isGuest }).find(s => s.key === key)
  if (!section) return null
  return resolveSectionHref(sectionByKey(section.key), items)
}
