/**
 * 브라우저 전용: 이 기기의 푸시 구독 정리·확인 — 원본 kosmart-work `lib/push/device.ts`. 서버 코드에서 import 하지 않는다.
 * 같은 기기를 다른 사람이 이어 쓸 때 이전 사용자의 멘션·DM 알림이 새 사용자 화면에 뜨지 않게 한다.
 *
 * ggac 이식: 서비스 워커는 업무툴 전용(`/board-work-sw.js`, 범위 `/board-room/`)이다. 공개 사이트 화면에서 로그아웃할 때도
 * 이 범위의 등록을 찾아 정리해야 하므로 `getRegistration(BOARD_WORK_SW_SCOPE)`로 찾는다(현재 문서 주소로 찾지 않는다).
 * 원본의 `serverRelease:false`(2단계 인증 전 /mfa)는 ggac에 2단계 인증이 없어 뺐다.
 */

/** 서비스 워커 스크립트와 범위 — public/board-work-sw.js */
export const BOARD_WORK_SW_URL = '/board-work-sw.js'
export const BOARD_WORK_SW_SCOPE = '/board-room/'

/** ServiceWorkerRegistrar가 하루 두 번 서버에 구독을 다시 알릴 때 쓰는 마지막 시각 키 */
export const PUSH_SYNC_KEY = 'kw-push-synced-at'

const SW_WAIT_MS = 1500

/** 업무툴 서비스 워커 등록을 잠깐만 기다린다(없거나 느리면 null — 로그아웃을 막지 않는다) */
async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.getRegistration(BOARD_WORK_SW_SCOPE),
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), SW_WAIT_MS)),
    ])
    return reg ?? null
  } catch {
    return null
  }
}

/**
 * 업무툴 서비스 워커를 등록하고 **활성화될 때까지** 기다린다. `navigator.serviceWorker.ready`를 쓰지 않는 이유:
 * `ready`는 "지금 페이지를 제어하는" 등록만 기다린다 — 범위가 `/board-room/`이라 `/en/board-room/…` 화면에서는
 * 영영 풀리지 않는다. 구독(pushManager.subscribe)에는 활성 워커만 있으면 된다.
 */
export async function ensureWorkServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg =
    (await navigator.serviceWorker.getRegistration(BOARD_WORK_SW_SCOPE)) ??
    (await navigator.serviceWorker.register(BOARD_WORK_SW_URL, { scope: BOARD_WORK_SW_SCOPE }))
  if (reg.active) return reg
  const worker = reg.installing ?? reg.waiting
  if (!worker) return reg
  await new Promise<void>(resolve => {
    const done = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', done)
        resolve()
      }
    }
    worker.addEventListener('statechange', done)
    done()
  })
  return reg
}

/**
 * 표식 값은 `<userId>:<시각ms>` — 사용자가 바뀌면(로그아웃 정리가 빠진 경로 포함) 12시간 건너뛰기가 적용되지 않아
 * 409 판정·해지가 다시 돈다. 사용자 id 없는 옛 형식(숫자만)은 건너뛰기에 쓰지 않는다.
 */
export function formatPushSyncMark(userId: string, now: number = Date.now()): string {
  return `${userId}:${now}`
}

/** 표식이 이 사용자 것이고 intervalMs 안이면 true(= 서버 확인을 건너뛴다) */
export function isPushSyncFresh(
  raw: string | null,
  userId: string | null,
  intervalMs: number,
  now: number = Date.now()
): boolean {
  if (!raw || !userId) return false
  const i = raw.lastIndexOf(':')
  if (i <= 0) return false
  if (raw.slice(0, i) !== userId) return false
  const t = Number(raw.slice(i + 1))
  return Number.isFinite(t) && t <= now + 60_000 && now - t < intervalMs
}

export function clearPushSyncMark(): void {
  try {
    window.localStorage.removeItem(PUSH_SYNC_KEY)
  } catch {
    // 무시
  }
}

/**
 * 이 기기의 푸시 구독을 해지한다: (로그인 상태라면) 서버 행 삭제 → 브라우저 구독 해지 → 동기화 표식 삭제.
 * 어느 단계가 실패해도 던지지 않는다(로그아웃은 계속). 반드시 로그아웃 **전에** 부른다 — 서버 해지는 세션이 필요하다.
 * 업무툴 서비스 워커가 없는 브라우저(공개 사이트만 쓰는 조합원)는 아무 요청도 보내지 않는다.
 */
export async function releaseDevicePushSubscription(): Promise<void> {
  try {
    const reg = await currentRegistration()
    const sub = await reg?.pushManager?.getSubscription()
    if (sub) {
      await fetch('/api/board-room/work/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => null)
      await sub.unsubscribe().catch(() => false)
    }
  } catch {
    // 구독 정리 실패는 로그아웃을 막지 않는다
  }
  clearPushSyncMark()
}

/** 서버가 이 endpoint를 "내 구독"으로 가지고 있는가(남의 것·없음·오류는 false) */
export async function isSubscriptionMine(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch('/api/board-room/work/push/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
    if (!res.ok) return false
    const json = (await res.json()) as { data?: { mine?: unknown } }
    return json.data?.mine === true
  } catch {
    return false
  }
}
