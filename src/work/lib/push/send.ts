import webpush from 'web-push'
import {
  deletePushSubscriptionsByIds,
  listPushSubscriptionsFor,
  touchPushSubscriptions,
} from '@/db/queries/work/push'
import { deliverPush, type PushTransport, type VapidConfig } from './deliver'
import type { PushPayload } from './payload'

export type { PushPayload, PushTransport, VapidConfig }

/**
 * 웹 푸시 발송 — 원본 kosmart-work `lib/push/send.ts`. 서버 전용.
 *
 * 바뀐 점:
 * - 구독 읽기·삭제·갱신은 쿼리 계층(`src/db/queries/work/push.ts`)이다(원본 service_role).
 * - 몸통(SSRF 재검사·404/410 분류)은 순수 함수 `deliver.ts`로 뺐다 — 시험이 DB·네트워크 없이 본다.
 * - **발송 수단을 주입할 수 있다**(`transport`). 기본은 `web-push`이고, 시험은 가짜를 넘긴다.
 *   VAPID 키가 없으면 어떤 transport든 부르지 않는다(no-op) — E2E 서버는 키를 빈 값으로 덮어 실제 푸시가 나갈 길이 없다.
 */

export type PushSendResult = {
  /** 발송 시도 대상이 아예 없었거나 VAPID 미설정이면 skipped 에 사유가 든다. */
  skipped?: 'not_configured' | 'no_recipients' | 'no_subscriptions'
  sent: number
  failed: number
  /** 410/404 로 삭제한 만료 구독 수 */
  removed: number
}

const NOOP: PushSendResult = { sent: 0, failed: 0, removed: 0 }

/** VAPID 설정. 하나라도 비면 null → 푸시는 no-op. */
export function getVapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = (env.WEB_PUSH_PUBLIC_KEY || env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || '').trim()
  const privateKey = (env.WEB_PUSH_PRIVATE_KEY || '').trim()
  if (!publicKey || !privateKey) return null
  const site = env.NEXT_PUBLIC_SITE_URL?.trim()
  const subject = site?.startsWith('https://') ? site : 'mailto:noreply@ggac.kr'
  return { publicKey, privateKey, subject }
}

/** 설정 화면에 넘길 공개키 — 비공개키까지 있어 실제로 보낼 수 있을 때만(아니면 "준비되지 않음") */
export function getVapidPublicKey(): string | null {
  return getVapidConfig()?.publicKey ?? null
}

export const webPushTransport: PushTransport = async (subscription, body, vapid) => {
  await webpush.sendNotification(subscription, body, {
    TTL: 60 * 60 * 24,
    urgency: 'normal',
    vapidDetails: {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  })
}

/**
 * 사용자들의 모든 기기 구독으로 푸시를 보낸다. 절대 던지지 않는다(메시지 저장 흐름을 막지 않는다).
 * - VAPID 환경변수가 없으면 아무것도 하지 않는다(no-op).
 * - 410 Gone / 404 → 만료된 구독이므로 삭제한다. 그 외 실패는 로그만.
 * - 성공한 구독은 last_seen_at 을 갱신한다(90일 정리 대상에서 제외).
 * 호출자는 이미 **수신자 판정을 끝낸** 서버 코드여야 한다(이 함수는 누구에게 보낼지 판단하지 않는다).
 */
export async function sendPushToUsers(
  userIds: readonly string[],
  payload: PushPayload,
  opts: { transport?: PushTransport } = {}
): Promise<PushSendResult> {
  const vapid = getVapidConfig()
  if (!vapid) return { ...NOOP, skipped: 'not_configured' }
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return { ...NOOP, skipped: 'no_recipients' }

  try {
    const subs = await listPushSubscriptionsFor(ids)
    if (subs.length === 0) return { ...NOOP, skipped: 'no_subscriptions' }
    const outcome = await deliverPush(subs, payload, vapid, opts.transport ?? webPushTransport)
    if (outcome.blocked > 0) {
      console.error(`[push] 허용되지 않는 endpoint ${outcome.blocked}건 건너뜀`)
    }
    if (outcome.goneIds.length > 0) {
      await deletePushSubscriptionsByIds(outcome.goneIds).catch(e =>
        console.error('[push] 만료 구독 삭제 실패:', e)
      )
    }
    if (outcome.okIds.length > 0) {
      await touchPushSubscriptions(outcome.okIds).catch(e =>
        console.error('[push] last_seen_at 갱신 실패:', e)
      )
    }
    if (outcome.okIds.length + outcome.goneIds.length + outcome.failed === 0) {
      return { ...NOOP, skipped: 'no_subscriptions' }
    }
    return { sent: outcome.okIds.length, failed: outcome.failed, removed: outcome.goneIds.length }
  } catch (err) {
    console.error('[push] sendPushToUsers 예외:', err)
    return { ...NOOP, failed: 1 }
  }
}
