/**
 * 브라우저 전용 푸시 헬퍼(순수 함수 + 기능 감지). 서버 코드에서 import 하지 않는다.
 */

/** VAPID 공개키(base64url) → PushManager.subscribe 가 받는 바이트 배열. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  // iPadOS 13+ 는 Mac 으로 위장한다
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/** 홈 화면에 추가돼 독립 앱으로 실행 중인가. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  )
}

/**
 * iOS 는 "홈 화면에 추가"한 PWA 에서만 Web Push 를 받는다(iOS/iPadOS 16.4+).
 * true 면 구독 전에 설치 안내를 보여 줘야 한다.
 */
export function needsIosInstall(
  userAgent: string,
  standalone: boolean,
  maxTouchPoints = 0
): boolean {
  return isIosDevice(userAgent, maxTouchPoints) && !standalone
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}
