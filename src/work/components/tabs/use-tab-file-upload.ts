'use client'

import { useCallback } from 'react'
import {
  useAttachmentUploads,
  type AttachmentUploads,
} from '@work/components/files/useAttachmentUploads'
import { postFileUploadMessage } from '@work/lib/tabs/actions'

/**
 * 파일 탭용 업로드(＋ 대화상자 "새로 올리기"·탭 메뉴 "새 버전 올리기" 공용).
 * 기존 업로드 이음매(`useAttachmentUploads`)를 그대로 쓴다 — 올리기는 pending/ 에 직접 PUT,
 * 끝난 뒤 commit() 이 "A님이 'x' 파일을 올렸습니다." 게시물을 만들고(postFileUploadMessage)
 * attachTo(messageId) 로 첨부를 확정해 새 첨부 id 를 돌려준다. 파일은 한 개만.
 */
export function useTabFileUpload(channelId: string): {
  uploads: AttachmentUploads
  /** 올릴 파일이 하나이고 업로드가 끝났나 */
  ready: boolean
  commit: (
    purpose: 'tab' | 'version'
    // ggac 이식: strict: false 라 ok 판별로 좁혀지지 않는다 — 양쪽에 상대 키를 `?: undefined`로 둔다
  ) => Promise<
    | { ok: true; attachmentId: string; error?: undefined }
    | { ok: false; error: string; attachmentId?: undefined }
  >
} {
  const uploads = useAttachmentUploads({ channelId })
  const ready = uploads.items.length === 1 && uploads.uploadIds.length === 1
  const { items, uploadIds, attachTo, clear } = uploads

  const commit = useCallback(
    async (purpose: 'tab' | 'version') => {
      if (items.length !== 1 || uploadIds.length !== 1) {
        return { ok: false as const, error: '올릴 파일을 하나만 골라 주세요.' }
      }
      const posted = await postFileUploadMessage({
        channelId,
        fileName: items[0].name,
        purpose,
      })
      if (!posted.ok) return { ok: false as const, error: posted.error }
      const result = await attachTo(posted.data.messageId)
      const first = result?.attached[0]
      if (!first) {
        const why = result?.failed[0]?.error ?? '파일을 저장하지 못했습니다.'
        return { ok: false as const, error: why }
      }
      clear()
      return { ok: true as const, attachmentId: first.id }
    },
    [channelId, items, uploadIds, attachTo, clear]
  )

  return { uploads, ready, commit }
}
