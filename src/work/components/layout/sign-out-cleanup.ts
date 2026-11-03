'use client'

import { clearUserLocalData, suspendDraftWrites } from '@work/lib/messages/drafts'
import { releaseDevicePushSubscription } from '@work/lib/push/device'
import { clearEditHandles } from '@work/components/files/versions/edit-handles'
import { purgeOfficeEditorStorage } from '@work/lib/files/office-purge'
import { LAST_CHANNEL_KEY, LAST_DM_KEY, LAST_SECTION_KEY } from './use-last-location'

/**
 * 로그아웃 직전에 이 브라우저에 남은 업무툴 흔적을 지운다(다음 사용자에게 보이지 않게) — 원본
 * `components/auth/sign-out-cleanup.ts`. 로그아웃 **전에** 부른다(푸시 구독의 서버 해지에 세션이 필요하다):
 *  - 이 기기 푸시 구독(서버 행 + 브라우저 구독 + 동기화 표식, 5단계)
 *  - 임시 저장(입력 중이던 글)·이어 올리기 기록
 *  - 마지막으로 본 위치(kw-last-dm·kw-last-channel·kw-last-section — 이전 사용자의 대화 id)
 *  - "내 PC에서 수정" 파일 핸들(IndexedDB `kw-edit-handles`)·기준 버전 기록(3단계)
 *  - 앱 편집기 출처(ONLYOFFICE·rhwp 정적 사이트)의 분할 저장소 — 숨은 iframe 으로 `${ORIGIN}/purge.html`
 *    (Clear-Site-Data)을 한 번 불러 지운다(env 가 있을 때만, 최대 3초). rhwp 자동 복구 초안도 여기서 지워진다.
 */
export async function cleanupBeforeSignOut(): Promise<void> {
  // 정리 뒤 입력창이 사라지며 임시 저장을 다시 쓰지 않게 가장 먼저 막는다
  suspendDraftWrites()
  await releaseDevicePushSubscription() // 동기화 표식도 함께 지운다
  clearUserLocalData()
  try {
    for (const key of [LAST_DM_KEY, LAST_CHANNEL_KEY, LAST_SECTION_KEY]) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // 지우지 못해도 로그아웃은 계속한다
  }
  await clearEditHandles()
  await purgeOfficeEditorStorage()
}
