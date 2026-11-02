'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { XIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { cn } from '@work/lib/utils'

/**
 * 우측 패널(스레드·파일 상세·멤버 목록) 슬롯 — 데스크톱 360px 3단째, 모바일은 전체화면.
 *
 * 사용(클라이언트 컴포넌트에서):
 *   const panel = useRightPanel();
 *   panel.open({ key: `thread:${id}`, title: '스레드', content: <Thread id={id} /> });
 *   panel.close();
 * 같은 key 로 다시 open 하면 내용만 바뀐다(토글하려면 panel.toggle). Esc 로 닫힌다.
 *
 * 포커스: 사용자가 무언가에 포커스를 둔 채(답글 단추 클릭 등) 새 key 로 열면 패널 제목으로 옮기고
 * (스크린리더가 무엇이 열렸는지 읽는다), 닫히면 그 요소로 되돌린다(아직 화면에 있고 포커스를 잃었을 때만).
 * 페이지가 스스로 여는 경우(위키 목차 자동 열기 — 포커스가 body)는 포커스를 건드리지 않는다.
 *
 * 모바일(<768px)은 전체 화면이라 열 때 history 항목을 넣어 뒤로 가기가 패널 닫기가 되게 한다(아래 Provider 주석).
 */
export type RightPanelView = {
  /** 무엇을 보여주는지 식별(예: 'thread:<id>', 'members:<channelId>') */
  key: string
  /** 패널 머리글(스크린리더 레이블 겸용) */
  title: string
  content: ReactNode
}

export type RightPanelApi = {
  view: RightPanelView | null
  isOpen: boolean
  open: (view: RightPanelView) => void
  close: () => void
  /** 같은 key 가 열려 있으면 닫고, 아니면 연다 */
  toggle: (view: RightPanelView) => void
}

const RightPanelContext = createContext<RightPanelApi | null>(null)
/** 슬롯이 "열린 직후 제목으로 포커스를 옮길지" 한 번 묻는다(내부용) */
const FocusRequestContext = createContext<() => boolean>(() => false)

/** 패널이 전체 화면이 되는 폭(CSS `md` 미만) */
function isMobileViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
}

/** 패널 밖에서 포커스를 갖고 있던 요소(패널을 연 단추 등) */
function outsideFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body) return null
  if (el.closest('[data-right-panel]')) return null
  return el
}

export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RightPanelView | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const focusRequestRef = useRef(false)

  const remember = useCallback(() => {
    const el = outsideFocus()
    if (el) returnFocusRef.current = el
    focusRequestRef.current = el !== null
  }, [])
  const takeFocusRequest = useCallback(() => {
    const v = focusRequestRef.current
    focusRequestRef.current = false
    return v
  }, [])
  const open = useCallback(
    (next: RightPanelView) => {
      remember()
      setView(next)
    },
    [remember]
  )
  const close = useCallback(() => setView(null), [])
  const toggle = useCallback(
    (next: RightPanelView) => {
      remember()
      setView(cur => (cur?.key === next.key ? null : next))
    },
    [remember]
  )

  // 닫히면 포커스를 되돌린다(패널 안에 있던 포커스가 body 로 떨어지지 않게)
  const isOpen = view !== null
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const target = returnFocusRef.current
    returnFocusRef.current = null
    const active = document.activeElement
    const focusLost = !active || active === document.body
    if (target && target.isConnected && focusLost) target.focus()
  }, [isOpen])

  // 모바일(<768px)에서는 패널이 전체 화면이라 "뒤로 가기"가 패널 닫기여야 한다 — 스레드를 연 채 뒤로 제스처를 하면
  // 대화 화면을 떠나던 것을 막는다. 열 때 history 항목을 하나 넣고, popstate 면 닫고, 단추·Esc 로 닫을 땐 그 항목을 되감는다.
  // 되감기는 아직 같은 주소에 있을 때만(패널 안 링크로 다른 화면에 갔다면 그 항목은 이미 지나갔다) — 남의 항목을 건드리지 않는다.
  // 데스크톱·matchMedia 없는 환경(jsdom)은 건드리지 않는다.
  const pushedHrefRef = useRef<string | null>(null)
  const key = view?.key ?? null
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isOpen) {
      if (pushedHrefRef.current === null && isMobileViewport()) {
        window.history.pushState({ kwPanel: key }, '')
        pushedHrefRef.current = window.location.href
      }
      return
    }
    const pushed = pushedHrefRef.current
    if (pushed === null) return
    pushedHrefRef.current = null
    if (window.location.href === pushed) window.history.back()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 는 처음 열 때 한 번만 쓴다(열림/닫힘 전환에만 반응)
  }, [isOpen])
  useEffect(() => {
    function onPopState() {
      if (pushedHrefRef.current === null) return
      pushedHrefRef.current = null
      setView(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!view) return
    function onKey(e: KeyboardEvent) {
      // 다이얼로그(⌘K 등)가 열려 있으면 그쪽이 먼저 Esc 를 처리한다.
      // 한글 IME 조합 중 Esc 는 조합 취소·확정이지 패널 닫기가 아니다.
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode !== 229)
        setView(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const api = useMemo<RightPanelApi>(
    () => ({ view, isOpen: view !== null, open, close, toggle }),
    [view, open, close, toggle]
  )

  return (
    <RightPanelContext.Provider value={api}>
      <FocusRequestContext.Provider value={takeFocusRequest}>
        {children}
      </FocusRequestContext.Provider>
    </RightPanelContext.Provider>
  )
}

export function useRightPanel(): RightPanelApi {
  const ctx = useContext(RightPanelContext)
  if (!ctx) throw new Error('useRightPanel 은 RightPanelProvider 안에서만 쓸 수 있습니다')
  return ctx
}

/** 앱 셸이 렌더하는 패널 본체. 열려 있지 않으면 아무것도 그리지 않는다. */
export function RightPanelSlot({ className }: { className?: string }) {
  const { view, close } = useRightPanel()
  const takeFocusRequest = useContext(FocusRequestContext)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const key = view?.key ?? null
  useEffect(() => {
    const wanted = takeFocusRequest()
    if (key && wanted) headingRef.current?.focus()
  }, [key, takeFocusRequest])
  if (!view) return null
  return (
    <aside
      data-right-panel=""
      aria-label={view.title}
      className={cn(
        'fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-panel md:shrink-0 md:border-l',
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="truncate text-base font-semibold outline-none"
        >
          {view.title}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="패널 닫기">
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{view.content}</div>
    </aside>
  )
}
