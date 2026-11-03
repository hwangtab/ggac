'use client'

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { RhwpEditor } from '@rhwp/editor'
import {
  HWP_DIRTY_POLL_MS,
  HWP_LOAD_TIMEOUT_MS,
  HWP_SAVE_TIMEOUT_MS,
  checkHwpExport,
  checkHwpVerify,
  checkHwpxExport,
  guardEditorIframe,
  type HwpEditFormat,
} from '@work/lib/files/hwp-editor'

export type HwpEditorHandle = {
  /** 브라우저 검사(exportHwpVerify → exportHwp → 매직·크기)를 하고 결과를 onSaved / onError 로 알린다 */
  requestSave: () => void
  /** 저장본이 서버에 새 버전으로 올라간 뒤 호출 — rhwp 의 변경 표시·자동 복구 초안을 정리한다 */
  markSaved: () => Promise<void>
}

export type HwpEditorPhase = 'loading' | 'ready'

const GENERIC_ERROR = '편집기에서 오류가 발생했습니다.'

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** 우리가 만든 시간 초과 문구만 화면에 내보낸다 — SDK·문서에서 온 메시지는 내용이 섞일 수 있어 숨긴다 */
class Shown extends Error {}

/**
 * HWP 편집기(rhwp-studio) iframe — 공식 SDK `@rhwp/editor` 를 클라이언트에서만 동적으로 불러 쓴다(docs/12 §2).
 * 보안: 편집기는 kosmart.org 밖 출처(`/rhwp/`)라 쿠키·DOM 은 출처로 격리되고 외부 전송은 편집기 사이트 CSP 가 막는다.
 * 편집기에는 URL·토큰·쿠키 없이 바이트(loadFile)만 넘긴다. 컨테이너를 DOM 에서 옮기지 않는다(옮기면 iframe 재로드).
 * 저장 파일은 쪽 수 일치·재로드 성공·매직 바이트·크기를 확인한 뒤에만 올린다. 오류 문구에 문서 내용을 싣지 않는다.
 */
export default function HwpEditorFrame({
  studioUrl,
  fileName,
  format = 'hwp',
  loadBuffer,
  onPhase,
  onDirtyChange,
  onSaved,
  onError,
  ref,
  loadTimeoutMs = HWP_LOAD_TIMEOUT_MS,
  saveTimeoutMs = HWP_SAVE_TIMEOUT_MS,
  dirtyPollMs = HWP_DIRTY_POLL_MS,
}: {
  /** `<편집기 출처>/rhwp/` */
  studioUrl: string
  /** 원본 파일 이름 */
  fileName: string
  /** 저장 형식 — hwp 는 `exportHwpVerify`+`exportHwp`, hwpx 는 `exportHwpx`(docs/18 §2). 원본 형식 그대로 */
  format?: HwpEditFormat
  /** 원본 바이트를 받아 온다(`/api/files/<id>?download=1`, 새 문서는 정적 서식) */
  loadBuffer: () => Promise<ArrayBuffer>
  onPhase?: (phase: HwpEditorPhase) => void
  onDirtyChange?: (dirty: boolean) => void
  /** 검사를 통과한 저장 파일 */
  onSaved: (file: File) => void
  onError: (message: string) => void
  ref?: Ref<HwpEditorHandle>
  loadTimeoutMs?: number
  saveTimeoutMs?: number
  dirtyPollMs?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<RhwpEditor | null>(null)
  const readyRef = useRef(false)
  const saveSeq = useRef(0)
  const cb = useRef({ onPhase, onDirtyChange, onSaved, onError })
  useEffect(() => {
    cb.current = { onPhase, onDirtyChange, onSaved, onError }
  })

  useImperativeHandle(
    ref,
    () => ({
      requestSave: () => {
        const editor = editorRef.current
        if (!editor || !readyRef.current) {
          cb.current.onError('편집기가 아직 준비되지 않았습니다.')
          return
        }
        const seq = ++saveSeq.current
        const run = async () => {
          if (format === 'hwpx') {
            // SDK 에 HWPX 용 쪽 수 재확인 API 가 없다 — 구조·쪽 수 검증은 서버 verify 가 한다
            const checkedX = checkHwpxExport(await editor.exportHwpx(), fileName)
            if (!checkedX.ok) throw new Shown(checkedX.error)
            return checkedX.file
          }
          const verify = await editor.exportHwpVerify()
          const blocked = checkHwpVerify(verify)
          if (blocked) throw new Shown(blocked)
          const checked = checkHwpExport(await editor.exportHwp(), fileName)
          if (!checked.ok) throw new Shown(checked.error)
          return checked.file
        }
        withTimeout(
          run(),
          saveTimeoutMs,
          '저장 시간이 초과되었습니다. 변경 내용은 올라가지 않았습니다.'
        ).then(
          file => {
            if (seq === saveSeq.current) cb.current.onSaved(file)
          },
          (e: unknown) => {
            if (seq !== saveSeq.current) return
            // 시간 초과(우리 문구)와 검사 문구(Shown)만 보인다
            const own =
              e instanceof Shown || (e instanceof Error && e.message.startsWith('저장 시간'))
            cb.current.onError(own ? (e as Error).message : GENERIC_ERROR)
          }
        )
      },
      markSaved: async () => {
        try {
          await editorRef.current?.notifySaved(fileName)
        } catch {
          // 구버전 편집기(capability 없음)여도 저장 자체는 끝났다 — 자동 복구 초안만 남는다
        }
      },
    }),
    [fileName, format, saveTimeoutMs]
  )

  useEffect(() => {
    let cancelled = false
    let editor: RhwpEditor | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    readyRef.current = false
    cb.current.onPhase?.('loading')

    async function start() {
      const container = containerRef.current
      if (!container) return
      const [{ createEditor }, buffer] = await Promise.all([import('@rhwp/editor'), loadBuffer()])
      // SDK 가 만드는 iframe 에 sandbox·referrerPolicy 를 삽입 전에 건다(삽입 뒤에는 첫 내비게이션에 안 먹는다)
      const unguard = guardEditorIframe(container)
      let created: RhwpEditor
      try {
        created = await createEditor(container, {
          studioUrl,
          width: '100%',
          height: '100%',
        })
      } finally {
        unguard()
      }
      if (cancelled) {
        created.destroy()
        return
      }
      editor = created
      editorRef.current = created
      await created.loadFile(new Uint8Array(buffer), fileName)
      if (cancelled) return
      readyRef.current = true
      cb.current.onPhase?.('ready')

      // 사용자 편집은 이벤트로 오지 않는다(onDocumentChanged 는 에이전트 명령 전용) — 변경 여부를 주기적으로 묻는다
      let last = false
      poll = setInterval(() => {
        created
          .getDocumentState()
          .then(st => {
            if (cancelled || st.dirty === last) return
            last = st.dirty
            cb.current.onDirtyChange?.(st.dirty)
          })
          .catch(() => undefined)
      }, dirtyPollMs)
    }

    withTimeout(
      start(),
      loadTimeoutMs,
      '편집기를 불러오지 못했습니다. 시간이 초과되었습니다.'
    ).catch((e: unknown) => {
      if (cancelled) return
      const timedOut = e instanceof Error && e.message.startsWith('편집기를 불러오지')
      cb.current.onError(timedOut ? (e as Error).message : '편집기를 불러오지 못했습니다.')
    })

    return () => {
      cancelled = true
      readyRef.current = false
      if (poll) clearInterval(poll)
      editorRef.current = null
      try {
        editor?.destroy()
      } catch {
        // 이미 제거됨
      }
    }
  }, [studioUrl, fileName, loadBuffer, loadTimeoutMs, dirtyPollMs])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`${fileName} 편집기`}
      data-testid="hwp-editor-container"
      // 종이 면(흰 바탕)은 의도다 — 포스터의 `bg-white` 재매핑을 비켜 간다
      data-poster-keep=""
      className="size-full bg-white"
    />
  )
}
