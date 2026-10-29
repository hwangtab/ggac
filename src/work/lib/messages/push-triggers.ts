/**
 * 메시지 저장 뒤 어떤 푸시를 보낼지(순수). sendMessage 가 쓰고, 테스트가 규칙을 고정한다.
 * 규약(src/lib/push/notify.ts):
 *  - DM 은 notifyDm 만(멘션·스레드 푸시를 따로 보내지 않는다 — 상대가 곧 수신자).
 *  - 그 밖의 채널은 멘션된 사람이 있으면 notifyMention, 스레드 답글이면 notifyThreadReply,
 *    (channelPush 일 때 최상위 글이면) notifyChannel.
 *    둘 다여도 notify 쪽이 중복을 걸러 준다.
 */
export type PushTrigger = 'mention' | 'dm' | 'thread' | 'channel'

export function pushTriggersFor(input: {
  channelKind: 'public' | 'private' | 'dm' | null
  mentioned: readonly string[]
  parentId: string | null | undefined
  /**
   * 채널 새 글 푸시(0027)를 시도할지. 서버 액션이 "알림 수준을 '모든 새 글'로 둔 다른 멤버가 있을 때"만 true 로 넘긴다
   * (없으면 after 도 돌리지 않는다). 최상위 글에만 붙는다(답글은 thread·mention 으로 간다).
   */
  channelPush?: boolean
}): PushTrigger[] {
  if (input.channelKind === 'dm') return ['dm']
  const out: PushTrigger[] = []
  if (input.mentioned.length > 0) out.push('mention')
  if (input.parentId) out.push('thread')
  if (input.channelPush && !input.parentId && input.channelKind !== null) out.push('channel')
  return out
}
