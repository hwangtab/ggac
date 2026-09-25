/**
 * 알림 여러 건을 **간격을 두고** 하나씩 보낸다.
 *
 * 왜 `sendManyEmails`(`./notifyContent.ts`)를 그대로 쓰지 않는가 — 그쪽은
 * "같은 문안을 여러 주소에" 보내는 물건이라 **주소가 겹치면 하나로 합친다.**
 * 환불 통지는 후원 한 건에 하나씩 나가는 영수증이라 합치면 안 된다(한 사람이
 * 같은 프로젝트에 두 건 후원했다가 둘 다 환불되는 일은 드물지 않다). 그래서
 * 보내는 일 자체는 원래의 알림 함수에 맡기고, 이 파일은 **차례와 간격만**
 * 맡는다 — 간격 값은 `sendManyEmails`가 쓰는 것을 그대로 가져와, 한도 판단이
 * 두 군데로 갈라지지 않게 한다.
 *
 * 간격이 필요한 이유는 그쪽 주석에 적힌 것과 같다: Resend의 기본 한도가 **초당
 * 2통**이라, 한꺼번에 띄우면 429가 돌아오고 그 사람은 아무것도 못 받는다.
 * 한 리워드가 통째로 매진된 뒤 승인이 몰려 들어오면 환불 통지가 수십 건이 되는데,
 * 지금까지는 그 전부를 한 번에 띄우고 있었다.
 */

import { BULK_MIN_INTERVAL_MS, MAX_BULK_RECIPIENTS } from './notifyContent.ts'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export interface PacedNoticeResult {
  sent: number
  failed: number
  /** 상한을 넘어 보내지 않은 건수. */
  skipped: number
}

/**
 * `notices`를 앞에서부터 하나씩 부른다. 한 건이 던져도 나머지는 계속 나간다.
 *
 * 상한(`limit`)을 넘는 만큼은 보내지 않고 세어서 돌려준다 — 서버리스 함수의
 * 수명이 유한하므로, 도중에 끊겨 "누가 받았는지 모르는" 상태가 되느니 못 보낸
 * 건수를 아는 편이 낫다(`sendManyEmails`와 같은 판단이다).
 */
export async function sendNoticesPaced(
  notices: (() => Promise<void>)[],
  options: {
    minIntervalMs?: number
    limit?: number
    log?: { error: (msg: string, meta?: unknown) => void }
  } = {}
): Promise<PacedNoticeResult> {
  const interval = options.minIntervalMs ?? BULK_MIN_INTERVAL_MS
  const limit = options.limit ?? MAX_BULK_RECIPIENTS
  const result: PacedNoticeResult = { sent: 0, failed: 0, skipped: 0 }
  if (notices.length > limit) {
    result.skipped = notices.length - limit
    options.log?.error('알림 건수가 상한을 넘어 일부를 보내지 않음', {
      count: notices.length,
      limit,
    })
  }

  const queue = notices.slice(0, limit)
  for (const [index, send] of queue.entries()) {
    // 첫 통은 바로 보낸다 — 한 건뿐인 흔한 경우에 공연히 기다리지 않는다.
    if (index > 0 && interval > 0) await sleep(interval)
    try {
      await send()
      result.sent += 1
    } catch (error) {
      result.failed += 1
      options.log?.error('알림 발송 실패', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}
