import type { ReactNode } from 'react'
import type { CreateActor } from '@work/lib/files/create-rules'

/**
 * ggac 이식 1b 자리표시 — 새 문서 만들기(오피스·HWPX 편집기)는 2단계 이후(설계 §8-1).
 * 원본과 같은 모양을 돌려주되 늘 `available: false`라 입력창의 "새 문서" 단추가 숨는다.
 */
export function useCreateDocument(_opts: {
  channelId: string
  folderPath?: string | null
  parentId?: string | null
  actor: Omit<CreateActor, 'inThread'>
}): {
  available: boolean
  officeEnabled: boolean
  hwpxEnabled: boolean
  open: (type: string | null) => void
  dialog: ReactNode
} {
  return { available: false, officeEnabled: false, hwpxEnabled: false, open: noop, dialog: null }
}

function noop() {}
