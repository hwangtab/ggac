'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  OFFICE_IFRAME_ALLOW,
  OFFICE_IFRAME_SANDBOX,
  OFFICE_LOAD_TIMEOUT_MS,
  OFFICE_SAVE_TIMEOUT_MS,
  checkSavedOfficeFile,
  officeEditorSrc,
  officeSaveExtension,
} from '@work/lib/files/office-edit'

export type OfficeEditorHandle = {
  /** 편집기에 저장을 요청한다. 결과는 onSaved / onError 로 온다 */
  requestSave: () => void
}

export type OfficeEditorPhase = 'loading' | 'ready'

/**
 * Word·Excel·PPT 편집기 iframe(docs/11 §2-3, ranuts/document 임베드 API).
 * 보안 요건: ① 받는 메시지는 `origin === 편집기 출처 && source === iframe.contentWindow` 만 ② 보낼 때 targetOrigin = 편집기 출처(`'*'` 금지)
 * ③ sandbox·allow·referrerpolicy 고정 ④ 편집기에는 URL·토큰·쿠키 없이 바이트(open-buffer)만 ⑤ 저장 파일은 확장자·매직 바이트·크기 검사 후에만 올린다
 * ⑥ 로드·저장 60초 시간 초과는 오류(원본을 잘못 올리지 않는다).
 */
export default function OfficeEditorFrame({
  origin,
  parentOrigin,
  fileName,
  loadBuffer,
  onPhase,
  onDirtyChange,
  onSaved,
  onError,
  ref,
  loadTimeoutMs = OFFICE_LOAD_TIMEOUT_MS,
  saveTimeoutMs = OFFICE_SAVE_TIMEOUT_MS,
}: {
  /** 편집기 출처(`https://kosmart-office.vercel.app`) */
  origin: string
  /** 부모(이 앱) 출처 — 기본은 location.origin */
  parentOrigin?: string
  /** 원본 파일 이름(확장자 판정·저장 파일 검사) */
  fileName: string
  /** 원본 바이트를 받아 온다(`/api/files/<id>?download=1`) */
  loadBuffer: () => Promise<ArrayBuffer>
  onPhase?: (phase: OfficeEditorPhase) => void
  onDirtyChange?: (dirty: boolean) => void
  /**
   * 검사를 통과한 저장 파일(이름·MIME 이 원본 기준으로 정리됨). `dirty` 는 편집기가 내보내기를 마친 뒤에도 저장 안 된 변경이
   * 남았다고 알린 값(내보내는 동안 더 편집한 경우) — 편집기는 내보낸 시점에 변경 표시를 스스로 지운다.
   */
  onSaved: (file: File, info: { dirty: boolean }) => void
  onError: (message: string) => void
  ref?: Ref<OfficeEditorHandle>
  loadTimeoutMs?: number
  saveTimeoutMs?: number
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const seq = useRef(0)
  const loaded = useRef(false)
  const loadTimer = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  // 우리가 저장을 요청해 응답을 기다리는 동안만 true — 그 밖의 document:saved(시간 초과 뒤 늦은 응답·요청 없는 알림)는 무시한다
  const pendingSave = useRef(false)
  const bufferRef = useRef<Promise<ArrayBuffer> | null>(null)
  const cb = useRef({ onPhase, onDirtyChange, onSaved, onError })
  useEffect(() => {
    cb.current = { onPhase, onDirtyChange, onSaved, onError }
  })

  const clearTimer = (t: { current: number | null }) => {
    if (t.current !== null) window.clearTimeout(t.current)
    t.current = null
  }

  const post = useCallback(
    (type: string, payload: Record<string, unknown>, transfer: Transferable[] = []) => {
      const win = frameRef.current?.contentWindow
      if (!win) return
      seq.current += 1
      win.postMessage({ id: `kw-${seq.current}`, type, payload }, origin, transfer)
    },
    [origin]
  )

  const fail = useCallback((message: string) => {
    clearTimer(loadTimer)
    clearTimer(saveTimer)
    pendingSave.current = false
    cb.current.onError(message)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      requestSave: () => {
        pendingSave.current = true
        clearTimer(saveTimer)
        saveTimer.current = window.setTimeout(
          () => fail('저장 시간이 초과되었습니다. 변경 내용은 올라가지 않았습니다.'),
          saveTimeoutMs
        )
        const ext = officeSaveExtension(fileName)
        post('document:save', ext ? { targetExt: ext } : {})
      },
    }),
    [post, fail, fileName, saveTimeoutMs]
  )

  // 원본 바이트를 미리 받아 둔다(편집기가 ready 를 보내면 바로 넘긴다)
  useEffect(() => {
    loaded.current = false
    cb.current.onPhase?.('loading')
    bufferRef.current = loadBuffer()
    bufferRef.current.catch(() => undefined) // 처리는 ready 때 한다
    loadTimer.current = window.setTimeout(
      () => fail('편집기를 불러오지 못했습니다. 시간이 초과되었습니다.'),
      loadTimeoutMs
    )
    return () => {
      clearTimer(loadTimer)
      clearTimer(saveTimer)
    }
  }, [loadBuffer, fail, loadTimeoutMs])

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const win = frameRef.current?.contentWindow
      if (event.origin !== origin || !win || event.source !== win) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const { type, payload } = data as { type?: unknown; payload?: unknown }
      if (typeof type !== 'string') return
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >

      switch (type) {
        case 'document:ready': {
          if (loaded.current) return
          loaded.current = true
          try {
            const buffer = await (bufferRef.current ?? loadBuffer())
            post('document:open-buffer', { fileName, buffer, readonly: false }, [buffer])
          } catch {
            fail('원본 파일을 받지 못했습니다. 잠시 후 다시 시도해 주세요.')
          }
          return
        }
        case 'document:opened':
          clearTimer(loadTimer)
          cb.current.onPhase?.('ready')
          return
        case 'document:dirty-changed':
          cb.current.onDirtyChange?.(p.dirty === true)
          return
        case 'document:saved': {
          if (!pendingSave.current) return
          pendingSave.current = false
          clearTimer(saveTimer)
          const checked = await checkSavedOfficeFile(p.file, fileName)
          if (!checked.ok) {
            cb.current.onError(checked.error)
            return
          }
          cb.current.onSaved(checked.file, { dirty: p.dirty === true })
          return
        }
        case 'document:error':
          // 편집기의 오류 문구는 그대로 보이지 않는다(문서 내용이 섞일 수 있다)
          fail('편집기에서 오류가 발생했습니다.')
          return
        default:
          return
      }
    }
    const handler = (e: MessageEvent) => void onMessage(e)
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [origin, fileName, loadBuffer, post, fail])

  // 서버 렌더에는 location 이 없다 — 마운트 뒤에 정한다(서버·첫 클라이언트 렌더는 같은 빈 자리).
  // (서버에서 embedOrigin='' 로 iframe 을 그리면 하이드레이션이 src 를 고치지 않아, 주소로 바로 들어오면 편집기가 응답하지 않는다)
  const [clientOrigin, setClientOrigin] = useState('')
  useEffect(() => setClientOrigin(window.location.origin), [])
  const parent = parentOrigin ?? clientOrigin
  // 종이 면(흰 바탕)은 의도다 — data-poster-keep으로 포스터의 `bg-white` → 어두운 면 재매핑을 비켜 간다
  if (!parent) return <div data-poster-keep="" className="size-full bg-white" aria-hidden="true" />

  return (
    <iframe
      ref={frameRef}
      title={`${fileName} 편집기`}
      src={officeEditorSrc(origin, parent)}
      sandbox={OFFICE_IFRAME_SANDBOX}
      allow={OFFICE_IFRAME_ALLOW}
      referrerPolicy="no-referrer"
      data-poster-keep=""
      className="size-full border-0 bg-white"
    />
  )
}
