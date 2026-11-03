import { z } from 'zod'

/**
 * endpoint 로 서버가 직접 POST 하므로(web-push) 내부망·IP 직접 지정 주소는 막는다(SSRF 완화).
 * 실제 푸시 서비스(FCM·Mozilla·Apple·Windows)는 모두 공개 도메인명을 쓴다.
 */
export function isPublicPushHost(endpoint: string): boolean {
  let host: string
  try {
    host = new URL(endpoint).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!host.includes('.') || host.startsWith('[')) return false // 단일 라벨·IPv6 리터럴
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false // IPv4 리터럴
  return !/(^|\.)(localhost|local|internal|localdomain|lan|home|corp)$/.test(host)
}

/**
 * 알려진 푸시 서비스 호스트(허용 목록). 브라우저가 주는 endpoint 는 항상 이 서비스들의 것이다 —
 * `isPublicPushHost` 만으로는 `localhost.`(끝 점)·내부 IP 를 가리키는 공개 도메인을 못 막는다.
 * 새 등록(subscribe)에만 쓴다. 이미 저장된 구독은 지우지 않고, 발송 직전 검사는 `isPublicPushHost` 를 그대로 둔다.
 *  - FCM(Chrome·Edge·Brave·Opera·Samsung): fcm.googleapis.com
 *  - Mozilla: updates.push.services.mozilla.com 등 *.push.services.mozilla.com
 *  - Apple: web.push.apple.com 등 *.push.apple.com
 *  - Windows(WNS): wns2-*.notify.windows.com 등 *.notify.windows.com
 */
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  if (host === 'fcm.googleapis.com') return true
  // Chrome 은 FCM 외에 jmt<N>.google.com/fcm/send/… endpoint 도 준다(운영 구독 실측 2026-10-27)
  if (/^jmt\d+\.google\.com$/.test(host)) return true
  return PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix) && host.length > suffix.length)
}

/** POST /api/push/subscribe 본문 — PushSubscription.toJSON() 모양. */
export const subscribeBodySchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine(u => u.startsWith('https://'), '푸시 endpoint 는 https 여야 합니다')
    .refine(isPublicPushHost, '푸시 endpoint 호스트가 올바르지 않습니다')
    .refine(isAllowedPushEndpoint, '지원하는 푸시 서비스의 endpoint 가 아닙니다'),
  // PushSubscription.toJSON() 은 패딩 없는 base64url 이다. p256dh = 공개키 65바이트(87자), auth = 16바이트(22자).
  // 형식이 틀린 키는 web-push 가 매번 던져 발송 로그만 어지럽히므로 저장 전에 거른다.
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
  userAgent: z.string().max(500).optional(),
})

/** POST /api/push/unsubscribe 본문 */
export const unsubscribeBodySchema = z.object({
  endpoint: z.string().url().max(2048),
})

export type SubscribeBody = z.infer<typeof subscribeBodySchema>
