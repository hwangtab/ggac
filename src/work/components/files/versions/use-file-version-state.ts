'use client'

import { useCallback, useEffect, useState } from 'react'
import { listFileVersions } from '@work/lib/files/version-actions'
import type { FileVersionState } from '@work/lib/files/version-rules'
import { EDIT_CHANGED_EVENT, setEditOwner } from './edit-handles'

/**
 * 첨부 하나의 버전 상태(계보·수정 중·최종본·내 편집 권한)를 서버 액션으로 읽는다.
 * 수정 시작·취소·저장이 일어나면 `notifyEditChanged()` 신호로 다시 읽는다. 실패하면 state 는 null — 컨트롤은 숨는다.
 */
export function useFileVersionState(attachmentId: string | null): {
  state: FileVersionState | null
  reload: () => void
} {
  const [state, setState] = useState<FileVersionState | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    window.addEventListener(EDIT_CHANGED_EVENT, reload)
    return () => window.removeEventListener(EDIT_CHANGED_EVENT, reload)
  }, [reload])

  useEffect(() => {
    if (!attachmentId) {
      setState(null)
      return
    }
    let cancelled = false
    listFileVersions({ attachmentId })
      .then(res => {
        if (cancelled) return
        if (res.ok) setEditOwner(res.data.viewerId)
        setState(res.ok ? res.data : null)
      })
      .catch(() => {
        if (!cancelled) setState(null)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentId, tick])

  // 다른 파일로 바뀌면 이전 파일의 상태를 잠깐이라도 보이지 않게 한다
  const current = state && state.attachmentId === attachmentId ? state : null
  return { state: current, reload }
}
