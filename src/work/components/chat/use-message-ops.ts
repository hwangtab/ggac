'use client'

import { useCallback, type Dispatch } from 'react'
import { deleteMessage, editMessage, sendMessage, toggleReaction } from '@work/lib/messages/actions'
import { requestSync } from '@work/lib/messages/realtime'
import type { TimelineAction } from '@work/lib/messages/timeline'
import type { ChatMessage } from '@work/lib/messages/types'

/** 메시지는 저장됐지만 work.mentions 행을 못 만들었을 때(QA #1) */
export const MENTIONS_FAILED_MESSAGE =
  '메시지는 보냈지만 멘션 알림을 보내지 못했습니다. 상대에게 직접 알려 주세요.'

/**
 * 메시지 조작(낙관적 갱신 → 서버 확정 → 실패 시 되돌림). 타임라인과 스레드 패널이 같이 쓴다.
 * 실시간 이벤트도 같은 리듀서로 들어오므로, 같은 id·같은 반응은 중복 없이 합쳐진다.
 */
export function useMessageOps({
  dispatch,
  me,
  onError,
}: {
  dispatch: Dispatch<TimelineAction>
  me: string
  onError: (message: string) => void
}) {
  const send = useCallback(
    async (input: {
      channelId: string
      body: string
      parentId?: string | null
      /** 인용 답장 대상(0028) */
      quotedMessageId?: string | null
      attachmentIds?: string[]
      /** 실패한 메시지 다시 보내기 */
      retryId?: string
    }): Promise<string | null> => {
      const id = input.retryId ?? crypto.randomUUID()
      const optimistic: ChatMessage = {
        id,
        channel_id: input.channelId,
        parent_id: input.parentId ?? null,
        author_id: me,
        kind: 'text',
        body: input.body,
        attachments_count: input.attachmentIds?.length ?? 0,
        reply_count: 0,
        last_reply_at: null,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        reactions: [],
        attachments: [],
        quoted_message_id: input.quotedMessageId ?? null,
        // 요약(quoted)은 서버 확정 행이 채운다 — 낙관 행은 id 만 들고 있다
        quoted: null,
        forwarded_from_id: null,
        forwarded: null,
        status: 'pending',
      }
      dispatch({ type: 'upsert', message: optimistic })
      let res: Awaited<ReturnType<typeof sendMessage>>
      try {
        res = await sendMessage({
          channelId: input.channelId,
          messageId: id,
          body: input.body,
          parentId: input.parentId ?? null,
          quotedMessageId: input.quotedMessageId ?? null,
          attachmentIds: input.attachmentIds,
        })
      } catch (e) {
        console.error('[send]', e)
        res = { ok: false, error: '네트워크 오류로 보내지 못했습니다.' }
      }
      if (!res.ok) {
        dispatch({ type: 'status', id, status: 'failed' })
        onError(res.error)
        return null
      }
      dispatch({ type: 'upsert', message: res.data.message })
      // ggac 이식(폴링): 보낸 직후 즉시 1회 동기화 — 커서·배지를 바로 맞춘다(설계 §6-3)
      requestSync({ sentIn: input.channelId })
      if (res.data.mentionsFailed) onError(MENTIONS_FAILED_MESSAGE)
      return id
    },
    [dispatch, me, onError]
  )

  const react = useCallback(
    async (message: ChatMessage, emoji: string) => {
      const mine = message.reactions.some(r => r.emoji === emoji && r.user_id === me)
      const reaction = { message_id: message.id, user_id: me, emoji }
      dispatch({ type: 'reaction', op: mine ? 'remove' : 'add', reaction })
      let res: Awaited<ReturnType<typeof toggleReaction>>
      try {
        res = await toggleReaction({ messageId: message.id, emoji })
      } catch (e) {
        console.error('[react]', e)
        res = { ok: false, error: '네트워크 오류로 반응하지 못했습니다.' }
      }
      if (!res.ok) {
        dispatch({ type: 'reaction', op: mine ? 'add' : 'remove', reaction })
        onError(res.error)
        return
      }
      // 서버 결과가 기대와 다르면(다른 탭에서 이미 토글) 서버 쪽을 따른다
      dispatch({ type: 'reaction', op: res.data.active ? 'add' : 'remove', reaction })
    },
    [dispatch, me, onError]
  )

  const edit = useCallback(
    async (message: ChatMessage, body: string): Promise<boolean> => {
      dispatch({
        type: 'upsert',
        message: { ...message, body, edited_at: new Date().toISOString() },
      })
      let res: Awaited<ReturnType<typeof editMessage>>
      try {
        res = await editMessage({ messageId: message.id, body })
      } catch (e) {
        console.error('[edit]', e)
        res = { ok: false, error: '네트워크 오류로 고치지 못했습니다.' }
      }
      if (!res.ok) {
        dispatch({ type: 'upsert', message })
        onError(res.error)
        return false
      }
      dispatch({ type: 'upsert', message: res.data.message })
      if (res.data.mentionsFailed) onError(MENTIONS_FAILED_MESSAGE)
      return true
    },
    [dispatch, onError]
  )

  /** 삭제(낙관적). 서버까지 성공하면 true, 되돌렸으면 false */
  const remove = useCallback(
    async (message: ChatMessage): Promise<boolean> => {
      if (message.status) {
        // 아직 저장되지 않은(실패한) 메시지는 화면에서만 지운다
        dispatch({ type: 'remove', id: message.id })
        return true
      }
      dispatch({
        type: 'upsert',
        message: { ...message, body: '', deleted_at: new Date().toISOString() },
      })
      let res: Awaited<ReturnType<typeof deleteMessage>>
      try {
        res = await deleteMessage({ messageId: message.id })
      } catch (e) {
        console.error('[delete]', e)
        res = { ok: false, error: '네트워크 오류로 삭제하지 못했습니다.' }
      }
      if (!res.ok) {
        dispatch({ type: 'upsert', message })
        onError(res.error)
        return false
      }
      return true
    },
    [dispatch, onError]
  )

  return { send, react, edit, remove }
}
