/**
 * 브라우저 전역 API 타입 선언
 * (window.requestIdleCallback 등 DOM/Web API)
 */

interface IdleDeadline {
  readonly didTimeout: boolean
  timeRemaining: () => number
}

interface Window {
  requestIdleCallback: (
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout?: number }
  ) => number
}
