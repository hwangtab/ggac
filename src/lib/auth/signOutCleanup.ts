'use client'

import { MEMBER_DOCUMENT_EDITOR_USED_KEY } from '@/lib/memberDocuments/rules'
import { releaseDevicePushSubscription } from '@work/lib/push/device'

/**
 * 로그아웃 **직전에** 이 브라우저에 남은 흔적을 지운다 — 다음 사람이 같은 PC 를 쓸 때 보이지 않게. 던지지 않는다.
 *
 * - 이사회 업무툴을 쓸 수 있는 사람(이사·감사·관리자): 푸시 구독·임시 저장·마지막 위치·파일 핸들·편집기 출처 저장소(rhwp 자동
 *   복구 초안 포함)까지 `cleanupBeforeSignOut`이 지운다
 * - 그 밖의 사람: 푸시 구독만 확인하고, 내 문서함 편집기를 이 브라우저에서 연 적이 있으면 편집기 출처 저장소도 지운다
 *
 * `isBoardMember`가 `undefined`(프로필을 아직 못 읽었거나 모르는 화면)면 **업무툴 정리를 한다** — 모를 때 건너뛰면 이사가
 * 남긴 편집기 초안이 남는다(2026-11-05 점검: 로그인 화면의 "로그아웃"이 정리를 통째로 건너뛰었고, 내비도 프로필을 읽기 전
 * 로그아웃하면 건너뛰었다). 업무툴 정리는 업무툴을 안 쓴 브라우저에서도 무해하다(없는 것은 지우지 않는다).
 */
export async function cleanupBrowserForSignOut(isBoardMember?: boolean): Promise<void> {
  if (isBoardMember !== false) {
    try {
      const { cleanupBeforeSignOut } = await import('@work/components/layout/sign-out-cleanup')
      await cleanupBeforeSignOut()
    } catch (cleanupError) {
      console.error('[signOutCleanup] 업무툴 로그아웃 정리 실패:', cleanupError)
    }
  } else {
    await releaseDevicePushSubscription().catch(() => undefined)
  }
  try {
    if (window.localStorage.getItem(MEMBER_DOCUMENT_EDITOR_USED_KEY)) {
      if (isBoardMember === false) {
        const { purgeOfficeEditorStorage } = await import('@work/lib/files/office-purge')
        await purgeOfficeEditorStorage()
      }
      window.localStorage.removeItem(MEMBER_DOCUMENT_EDITOR_USED_KEY)
    }
  } catch (cleanupError) {
    console.error('[signOutCleanup] 문서함 편집기 정리 실패:', cleanupError)
  }
}
