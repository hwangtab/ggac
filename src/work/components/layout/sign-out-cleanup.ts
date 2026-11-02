'use client'

import { clearUserLocalData, suspendDraftWrites } from '@work/lib/messages/drafts'
import { LAST_CHANNEL_KEY, LAST_DM_KEY, LAST_SECTION_KEY } from './use-last-location'

/**
 * 로그아웃 직전에 이 브라우저에 남은 업무툴 흔적을 지운다(다음 사용자에게 보이지 않게) — 원본
 * `components/auth/sign-out-cleanup.ts`에서 이 단계에 있는 것만 옮겼다:
 *  - 임시 저장(입력 중이던 글)·이어 올리기 기록
 *  - 마지막으로 본 위치(kw-last-dm·kw-last-channel·kw-last-section — 이전 사용자의 대화 id)
 * 푸시 구독 해지(5단계)·편집 핸들·편집기 저장소(2단계 이후)는 그 기능을 옮길 때 더한다.
 */
export async function cleanupBeforeSignOut(): Promise<void> {
  // 정리 뒤 입력창이 사라지며 임시 저장을 다시 쓰지 않게 가장 먼저 막는다
  suspendDraftWrites()
  clearUserLocalData()
  try {
    for (const key of [LAST_DM_KEY, LAST_CHANNEL_KEY, LAST_SECTION_KEY]) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // 지우지 못해도 로그아웃은 계속한다
  }
}
