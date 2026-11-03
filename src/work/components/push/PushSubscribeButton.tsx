'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellIcon, BellOffIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  isPushSupported,
  isStandalone,
  needsIosInstall,
  urlBase64ToUint8Array,
} from '@work/lib/push/client'
import { ensureWorkServiceWorker, isSubscriptionMine } from '@work/lib/push/device'
import IosInstallGuide from './IosInstallGuide'

type Status = 'loading' | 'unsupported' | 'denied' | 'on' | 'off'

const SUBSCRIBE_URL = '/api/board-room/work/push/subscribe'
const UNSUBSCRIBE_URL = '/api/board-room/work/push/unsubscribe'

/**
 * 이 기기의 푸시 구독 토글 — 원본 kosmart-work `components/push/PushSubscribeButton.tsx`.
 * 구독은 `/api/board-room/work/push/subscribe`로 저장한다. iOS(홈 화면 미설치)에서는 누르면 설치 안내 모달을 연다.
 *
 * ggac 이식: VAPID 공개키는 빌드에 박지 않고 서버 페이지가 넘긴다(`publicKey` — 없으면 "준비되지 않음").
 * 서비스 워커는 업무툴 전용 범위(`/board-room/`)라 `navigator.serviceWorker.ready` 대신 `ensureWorkServiceWorker`로 기다린다.
 */
export default function PushSubscribeButton({ publicKey }: { publicKey?: string | null }) {
  const vapidKey = publicKey ?? ''
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iosGuide, setIosGuide] = useState(false)
  const [iosBlocked, setIosBlocked] = useState(false)

  const refresh = useCallback(async () => {
    const ios = needsIosInstall(navigator.userAgent, isStandalone(), navigator.maxTouchPoints)
    setIosBlocked(ios)
    if (ios) return setStatus('off')
    if (!isPushSupported() || !vapidKey) return setStatus('unsupported')
    if (Notification.permission === 'denied') return setStatus('denied')
    try {
      const reg = await ensureWorkServiceWorker()
      const sub = await reg.pushManager.getSubscription()
      // 브라우저에 구독이 있어도 서버가 "내 endpoint"라고 확인할 때만 켜짐(이전 사용자 구독이 남았을 수 있다)
      setStatus(sub && (await isSubscriptionMine(sub.endpoint)) ? 'on' : 'off')
    } catch {
      setStatus('unsupported')
    }
  }, [vapidKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function enable() {
    if (iosBlocked) return setIosGuide(true)
    setBusy(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await ensureWorkServiceWorker()
      const newSub = () =>
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
      const save = (sub: PushSubscription) => {
        const json = sub.toJSON()
        return fetch(SUBSCRIBE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent,
          }),
        })
      }
      const sub = (await reg.pushManager.getSubscription()) ?? (await newSub())
      let res = await save(sub)
      if (res.status === 409) {
        // 이 브라우저 구독(endpoint)이 다른 계정에 등록돼 있다 — 구독을 새로 만들어(새 endpoint) 다시 저장한다
        await sub.unsubscribe().catch(() => false)
        res = await save(await newSub())
      }
      if (!res.ok) throw new Error(`subscribe ${res.status}`)
      setStatus('on')
    } catch (err) {
      console.error('[push] 구독 실패:', err)
      setError('알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      const reg = await ensureWorkServiceWorker()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const res = await fetch(UNSUBSCRIBE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        if (!res.ok) throw new Error(`unsubscribe ${res.status}`)
        await sub.unsubscribe()
      }
      setStatus('off')
    } catch (err) {
      console.error('[push] 해지 실패:', err)
      setError('알림을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="push-subscribe">
      {status === 'on' ? (
        <Button type="button" variant="outline" onClick={disable} disabled={busy}>
          <BellOffIcon aria-hidden="true" />이 기기 알림 끄기
        </Button>
      ) : (
        <Button
          type="button"
          onClick={enable}
          disabled={busy || status === 'loading' || status === 'unsupported' || status === 'denied'}
        >
          <BellIcon aria-hidden="true" />이 기기 알림 켜기
        </Button>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {status === 'on' &&
          '이 기기에서 멘션·다이렉트 메시지·스레드 답글, 그리고 알림을 "모든 새 글"로 정한 채널의 새 글 알림을 받습니다.'}
        {status === 'off' &&
          !iosBlocked &&
          '멘션, 다이렉트 메시지, 내 스레드의 새 답글, 그리고 알림을 "모든 새 글"로 정한 채널의 새 글을 푸시로 받습니다.'}
        {status === 'off' &&
          iosBlocked &&
          'iPhone·iPad 는 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다.'}
        {status === 'denied' &&
          '브라우저에서 알림이 차단되어 있습니다. 주소창의 사이트 설정에서 허용으로 바꿔 주세요.'}
        {status === 'unsupported' &&
          '이 브라우저는 푸시 알림을 지원하지 않거나 설정이 아직 준비되지 않았습니다.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <IosInstallGuide open={iosGuide} onOpenChange={setIosGuide} />
    </div>
  )
}
