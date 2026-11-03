/* 이사회 업무툴 서비스 워커 — **푸시 전용**(docs/board-work/01-설계.md §8-4).
 *
 * 원본 kosmart-work `public/sw.js`에서 push·notificationclick만 남겼다. 정적 파일 캐시(install 프리캐시·fetch 가로채기)는
 * 뺐다 — 공개 사이트 전체에 캐시가 끼어드는 것을 막기 위해서다. 그래서 fetch 핸들러가 없다(요청은 늘 네트워크로 간다).
 * 등록은 업무툴 화면만 하고(`ServiceWorkerRegistrar`), 범위는 `/board-room/`이다.
 *
 * 알림 클릭은 **같은 출처의 `/board-room/` 아래(로케일 `/en` 포함)로만** 이동한다. 페이로드의 url이 다른 출처이거나
 * 업무툴 밖이면 업무툴 첫 화면으로 간다 — 푸시 서비스나 서버가 이상한 주소를 실어도 외부·공개 사이트로 끌려가지 않는다.
 */

const HOME = '/board-room/chat'
const ICON = '/images/logo/gac_logo.webp'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

/** 알림 클릭으로 열 주소 — 같은 출처 + `/board-room/`(또는 `/en/board-room/`) 아래만. 아니면 업무툴 첫 화면 */
function safeTarget(raw) {
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : HOME, self.location.origin)
    if (url.origin !== self.location.origin) return self.location.origin + HOME
    if (!/^\/(?:en\/)?board-room\//.test(url.pathname)) return self.location.origin + HOME
    return url.href
  } catch {
    return self.location.origin + HOME
  }
}

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : '이사회 업무'
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: ICON,
      badge: ICON,
      tag,
      renotify: Boolean(tag),
      data: { url: safeTarget(data.url) },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const dest = safeTarget(event.notification.data && event.notification.data.url)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        const u = new URL(client.url)
        if (u.origin === self.location.origin && /^\/(?:en\/)?board-room\//.test(u.pathname)) {
          if ('focus' in client) {
            return (
              client
                .focus()
                .then(c => (c && 'navigate' in c ? c.navigate(dest) : c))
                // 서비스 워커가 제어하지 않는 창은 navigate가 거부된다 → 새 창으로 연다
                .catch(() => self.clients.openWindow(dest))
            )
          }
        }
      }
      return self.clients.openWindow(dest)
    })
  )
})
