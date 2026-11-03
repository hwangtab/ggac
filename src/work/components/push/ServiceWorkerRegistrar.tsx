'use client'

import { useEffect } from 'react'
import {
  PUSH_SYNC_KEY as SYNC_KEY,
  ensureWorkServiceWorker,
  formatPushSyncMark,
  isPushSyncFresh,
} from '@work/lib/push/device'

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000

/**
 * 이미 구독한 기기의 구독을 서버에 다시 알린다(last_seen_at 갱신) — 원본 kosmart-work `components/push/ServiceWorkerRegistrar.tsx`.
 * 멘션·DM이 없어 푸시가 한 번도 안 간 기기는 서버가 "90일 미사용 구독"으로 지워 버리는데, 브라우저에는 구독이 남아
 * 설정 화면은 "켜짐"으로 보이고 알림은 영영 오지 않는다. 하루 두 번만 보낸다(localStorage가 막혀 있으면 열 때마다).
 */
async function syncPushSubscription(
  reg: ServiceWorkerRegistration,
  userId: string | null
): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // 표식에 사용자 id를 넣어, 사용자가 바뀌면 12시간 건너뛰기가 적용되지 않게 한다(409 판정·해지가 돈다)
  try {
    if (isPushSyncFresh(window.localStorage.getItem(SYNC_KEY), userId, SYNC_INTERVAL_MS)) return
  } catch {
    // localStorage 사용 불가 — 그대로 진행
  }
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON()
  const res = await fetch('/api/board-room/work/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  })
  if (res.status === 409) {
    // 이 브라우저 구독이 다른 계정 것이다(같은 기기를 이어 쓴 경우) — 해지해 그쪽 알림이 이 화면에 뜨지 않게 한다.
    // 설정 화면이 이 계정 구독을 새로 만든다.
    await sub.unsubscribe().catch(() => false)
    return
  }
  if (!res.ok) return // 로그아웃 상태(401) 등 — 다음 기회에
  try {
    if (userId) window.localStorage.setItem(SYNC_KEY, formatPushSyncMark(userId))
  } catch {
    // 무시
  }
}

/**
 * 업무툴 서비스 워커 등록(렌더 없음). **업무툴 앱 셸(AppShell)만** 끼운다 — 공개 사이트에는 서비스 워커를 두지 않는다
 * (설계 §8-4). 원본은 사이트 루트 레이아웃에 두고 세션 쿠키에서 사용자 id를 읽었다 — 여기서는 셸이 아는 `userId`를 받는다.
 * 페이지 로드가 끝난 뒤 등록해 첫 렌더를 방해하지 않는다. 실패는 앱 동작에 영향이 없다.
 */
export default function ServiceWorkerRegistrar({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const register = () => {
      ensureWorkServiceWorker()
        .then(reg => syncPushSubscription(reg, userId))
        .catch(err => {
          console.error('[sw] 등록·구독 동기화 실패:', err)
        })
    }
    if (document.readyState === 'complete') {
      register()
      return undefined
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [userId])
  return null
}
