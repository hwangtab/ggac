'use client'

/**
 * Cloudflare Turnstile 위젯 — 가입 화면의 사람 확인.
 *
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`가 없으면 아무것도 렌더링하지 않는다.
 * 서버 쪽(`@/lib/auth/turnstile`)도 `TURNSTILE_SECRET_KEY`가 없으면 검증을
 * 건너뛰므로, 이 키를 아직 설정하지 않은 환경(로컬 개발·이 기능을 켜지 않은
 * 프리뷰)에서 가입 자체가 막히면 안 된다는 원칙이 앞뒤로 맞는다.
 *
 * 토큰은 한 번 쓰면 무효가 된다. 제출이 검증 실패 이외의 이유로 실패해도
 * 같은 토큰을 재사용할 수 없으므로, 부모가 제출 실패 시 `reset()`을 불러
 * 위젯을 다시 그려야 한다.
 */

import Script from 'next/script'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        }
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

export type TurnstileWidgetHandle = {
  reset: () => void
}

type Props = {
  onVerify: (token: string) => void
  onExpire?: () => void
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(function TurnstileWidget(
  { onVerify, onExpire },
  ref
) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  const render = useCallback(() => {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onVerify,
      'expired-callback': onExpire,
    })
  }, [siteKey, onVerify, onExpire])

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current)
        }
      },
    }),
    []
  )

  if (!siteKey) return null

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={render}
      />
      <div ref={containerRef} data-testid="turnstile-widget" />
    </>
  )
})

export default TurnstileWidget
