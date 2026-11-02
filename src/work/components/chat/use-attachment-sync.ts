'use client'

import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import { loadMessageAttachments } from '@work/lib/messages/actions'
import type { TimelineAction } from '@work/lib/messages/timeline'
import type { AttachmentRow } from '@work/lib/messages/types'

const SYNC_DELAY_MS = 400

/**
 * 실시간 UPDATE 로 attachments_count 가 늘어난 메시지의 첨부를 다시 읽는다.
 * 첨부는 메시지 저장 뒤에 따로 확정되므로(파일 하나마다 카운터 갱신 → UPDATE 이벤트) 잠깐 모아서 한 번에 읽는다.
 * 내 메시지는 attachTo 결과로 바로 그리므로(브로드캐스트 self:false) 주로 남의 메시지가 대상이다.
 */
export function useAttachmentSync(dispatch: Dispatch<TimelineAction>): (messageId: string) => void {
  const pending = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    []
  )

  return useCallback(
    (messageId: string) => {
      pending.current.add(messageId)
      if (timer.current) return
      timer.current = setTimeout(async () => {
        timer.current = null
        const ids = [...pending.current]
        pending.current.clear()
        const res = await loadMessageAttachments({ messageIds: ids }).catch(e => {
          console.error('[attachments] 다시 읽기 실패:', e)
          return null
        })
        if (!res?.ok) return
        for (const [id, attachments] of Object.entries(
          res.data as Record<string, AttachmentRow[]>
        )) {
          dispatch({ type: 'attachments', id, attachments, replace: true })
        }
      }, SYNC_DELAY_MS)
    },
    [dispatch]
  )
}
