'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { checkoutFile, releaseCheckout } from '@work/lib/files/version-actions'
import { notifyEditChanged } from '../versions/edit-handles'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

export type EditGate =
  | { kind: 'checking' }
  | { kind: 'held'; name: string | null; since: string }
  | { kind: 'open' }
  | { kind: 'failed'; message: string }

/**
 * 앱 안 편집 화면(오피스 docs/11 · HWP docs/12)이 공유하는 "수정 중 표시".
 * 들어오면 checkoutFile(남이 잡고 있으면 held — 화면이 확인을 받고 `enter(true)`), 떠나면 releaseCheckout.
 * `baseRef` 는 저장할 때마다 새 기준 버전 id 로 바꿔 둔다(떠날 때 그 버전의 표시를 푼다).
 */
export function useEditCheckout(attachmentId: string | null) {
  // 기준 버전이 없는 새 문서(docs/16)는 수정 중 표시 없이 바로 열고, 첫 저장 뒤 adopt 로 기준을 잡는다
  const [gate, setGate] = useState<EditGate>(
    attachmentId === null ? { kind: 'open' } : { kind: 'checking' }
  )
  const baseRef = useRef<string | null>(attachmentId)
  // 이 화면이 실제로 잠금을 얻었는지 — 남의 잠금(held)·실패면 나갈 때 해제하지 않는다
  const heldByMeRef = useRef(false)

  const enter = useCallback(async (force: boolean) => {
    if (baseRef.current === null) return
    try {
      const res = await checkoutFile({ attachmentId: baseRef.current, force })
      if (!res.ok) {
        setGate({ kind: 'failed', message: res.error })
      } else if (res.data.status === 'held') {
        setGate({ kind: 'held', name: res.data.heldBy.userName, since: res.data.since })
      } else {
        heldByMeRef.current = true
        setGate({ kind: 'open' })
        notifyEditChanged()
      }
    } catch {
      setGate({ kind: 'failed', message: NETWORK_ERROR })
    }
  }, [])

  /** 새 문서의 첫 저장 뒤 — 새 v1 을 기준으로 삼고 수정 중 표시를 잡는다(남이 잡았으면 조용히 넘어간다) */
  const adopt = useCallback(async (newId: string) => {
    baseRef.current = newId
    try {
      const res = await checkoutFile({ attachmentId: newId })
      if (res.ok && res.data.status !== 'held') {
        heldByMeRef.current = true
        notifyEditChanged()
      }
    } catch {
      // 수정 중 표시는 편의 기능 — 못 잡아도 저장은 이미 끝났다
    }
  }, [])

  useEffect(() => {
    void enter(false)
    return () => {
      // 화면을 떠날 때 내 수정 중 표시를 푼다(실패해도 8시간 뒤 만료). 저장하면 기준 버전이 바뀌므로 떠나는 시점의 값을 읽는다
      const base = baseRef.current
      if (!heldByMeRef.current || base === null) return
      heldByMeRef.current = false
      void releaseCheckout({ attachmentId: base, onlyMine: true })
        .then(() => notifyEditChanged())
        .catch(() => undefined)
    }
  }, [enter])

  return { gate, setGate, enter, baseRef, adopt }
}

/** 저장 안 된 변경이 있으면 창 닫기·새로고침에서 브라우저 확인을 띄운다 */
export function useLeaveGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
