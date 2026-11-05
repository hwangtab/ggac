/**
 * 메시지를 고쳐 **새로** 멘션된 사람에게만 멘션 푸시를 예약한다 — `editMessage`(actions.ts)가 부른다. 서버 전용.
 *
 * 예전 `editMessage`는 멘션 행만 넣고 푸시를 예약하지 않아, 고친 글에서 멘션된 사람은 알림을 받지 못했다. 그렇다고
 * `notifyMention(messageId)`를 그대로 부르면 고치기 전부터 멘션돼 있던 사람에게도 같은 글로 다시 간다. 그래서
 * `recordMentionRowsDetailed`가 돌려준 **이번에 새로 들어간 행**(`added`)만 넘긴다. 받을지(알림 수준·방해 금지·이사회
 * 권한·읽기 범위)는 notify.ts 가 보내는 순간 다시 판정한다.
 *
 * `notify`·`schedule`은 호출부가 넘긴다(`notifyMention`·next/server `after()`) — 이 파일은 그 둘을 import 하지 않아
 * 시험이 DB·Next 없이 본다. 예약했으면 true.
 */
export function scheduleEditMentionPush(opts: {
  messageId: string
  added: readonly string[]
  notify: (messageId: string, opts: { onlyUserIds: readonly string[] }) => Promise<unknown>
  schedule: (run: () => Promise<void>) => void
}): boolean {
  const onlyUserIds = [...new Set(opts.added)]
  if (onlyUserIds.length === 0) return false
  opts.schedule(async () => {
    try {
      await opts.notify(opts.messageId, { onlyUserIds })
    } catch (e) {
      console.error('[editMessage] 멘션 푸시 실패:', e)
    }
  })
  return true
}
