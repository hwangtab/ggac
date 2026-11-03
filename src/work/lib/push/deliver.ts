import type { PushPayload } from './payload.ts'
import { isPublicPushHost } from './subscription.ts'

/**
 * 푸시 발송의 순수한 몸통(원본 kosmart-work `lib/push/send.ts`의 sendPushToUsers 본문) — 구독 목록을 받아 transport로
 * 보내고, 결과를 "성공·만료(404·410)·실패"로 나눈다. DB를 모른다: 만료 삭제·last_seen 갱신은 호출자(`send.ts`)가 한다.
 * `node --test`가 직접 읽는다(상대 import에 `.ts`).
 */

export type VapidConfig = { publicKey: string; privateKey: string; subject: string }

/** 한 구독에 한 번 보내는 함수. 실패는 statusCode를 단 오류로 던진다(web-push WebPushError와 같은 모양) */
export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  body: string,
  vapid: VapidConfig
) => Promise<void>

export type DeliverableSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type DeliveryOutcome = {
  okIds: string[]
  goneIds: string[]
  failed: number
  /** 발송 직전 SSRF 검사로 건너뛴 구독 수 */
  blocked: number
}

function statusOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode: unknown }).statusCode
    return typeof code === 'number' ? code : null
  }
  return null
}

/** 발송 직전 재검사(SSRF): https + 공개 호스트만. 저장 시점 검증을 우회해 들어온 행이 있어도 서버가 내부망으로 POST하지 않는다 */
export function isSendableEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('https://') && isPublicPushHost(endpoint)
}

export async function deliverPush(
  subscriptions: readonly DeliverableSubscription[],
  payload: PushPayload,
  vapid: VapidConfig,
  transport: PushTransport
): Promise<DeliveryOutcome> {
  const sendable = subscriptions.filter(s => isSendableEndpoint(s.endpoint))
  const out: DeliveryOutcome = {
    okIds: [],
    goneIds: [],
    failed: 0,
    blocked: subscriptions.length - sendable.length,
  }
  if (sendable.length === 0) return out
  const body = JSON.stringify(payload)
  await Promise.all(
    sendable.map(async s => {
      try {
        await transport(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          vapid
        )
        out.okIds.push(s.id)
      } catch (err) {
        const status = statusOf(err)
        if (status === 404 || status === 410) {
          out.goneIds.push(s.id)
        } else {
          out.failed += 1
          console.error(
            '[push] 발송 실패:',
            status ?? (err instanceof Error ? err.name : 'unknown')
          )
        }
      }
    })
  )
  return out
}
