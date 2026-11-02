'use client'

import { useSyncExternalStore } from 'react'

/** PC 전용(docs/11 §2-1): 넓은 화면이고 정밀 포인터(마우스)일 때만 */
export const DESKTOP_EDITOR_QUERY = '(min-width: 1024px) and (pointer: fine)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(DESKTOP_EDITOR_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DESKTOP_EDITOR_QUERY).matches
}

/** PC 환경인가. 서버 렌더·matchMedia 없는 환경은 false(진입점을 숨긴다) */
export function useDesktopEditor(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/**
 * PC 환경인가 — 판정 전에는 null. 직접 주소로 연 편집 화면이 서버 렌더 값(false)을 보고
 * "PC 에서 열어 주세요" 를 잠깐 비추지 않게, 브라우저가 판정하기 전과 뒤를 구분한다.
 */
export function useDesktopEditorKnown(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
