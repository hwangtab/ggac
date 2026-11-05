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
export const LEAVE_CONFIRM_MESSAGE =
  '저장하지 않은 변경이 있습니다. 이 화면을 떠나면 변경 내용이 사라집니다. 떠날까요?'

/**
 * 저장하지 않은 변경이 있으면 떠나기 전에 묻는다.
 *
 * - 창 닫기·새로 고침·주소 입력: `beforeunload`
 * - **사이트 안 링크 이동**(전역 내비·이사회실 메뉴·마이페이지 메뉴 등): 페이지를 새로 불러오지 않아 `beforeunload`가 뜨지
 *   않는다 — 편집 화면이 이 레이아웃들 **안에서** 열리므로 메뉴를 누르면 확인 없이 편집기가 내려가 변경이 사라졌다
 *   (2026-11-05 점검). 문서 전체의 클릭을 캡처 단계에서 가로채 묻는다(펀딩 편집 화면과 같은 방식). 새 탭·페이지 안 앵커·
 *   보조 키 클릭은 이 문서를 떠나지 않으니 통과시킨다.
 * - 브라우저 뒤로 가기는 Next 의 기록 처리와 겹쳐 여기서 막지 않는다(화면의 [돌아가기]는 따로 묻는다).
 */
export function useLeaveGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    // 링크 클릭에서 이미 "떠난다"를 골랐으면 이어지는 페이지 떠남(Next 밖 주소)에서 브라우저가 한 번 더 묻지 않게 한다
    let confirmedAt = 0
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Date.now() - confirmedAt < 3_000) return
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      confirmedAt = Date.now()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])
}
