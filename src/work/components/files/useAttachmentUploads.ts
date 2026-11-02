'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react'
import { upload } from '@vercel/blob/client'
import { attachUploads, discardUploads } from '@work/lib/files/actions'
import { resolveMime } from '@work/lib/files/mime'
import {
  MAX_FILES_PER_MESSAGE,
  MAX_FILE_BYTES,
  MAX_UPLOAD_MESSAGE,
  type AttachResult,
  type UploadTarget,
} from '@work/lib/files/schema'

/** 업로드 준비·토큰 라우트(설계 §7-2) — 준비(`type: 'prepare'`)와 SDK 토큰 요청이 같은 주소를 쓴다 */
export const UPLOADS_ENDPOINT = '/api/board-room/work/uploads'

export type UploadItemStatus = 'uploading' | 'paused' | 'done' | 'error'

export type UploadItem = {
  /** 클라이언트 전용 키 */
  localId: string
  name: string
  size: number
  mime: string
  status: UploadItemStatus
  /** 0~1 */
  progress: number
  /**
   * 원본: 50MB 초과 TUS(이어 올리기) 파일. ggac 이식은 이어 올리기를 가져오지 않아 늘 비어 있다
   * (큰 파일은 Blob 다중 조각 업로드로 올리고, 실패하면 처음부터 다시 올린다 — 설계 §7-2).
   */
  resumable?: boolean
  /** status === 'done' 일 때 서버의 pending_uploads.id */
  uploadId?: string
  error?: string
}

export type AttachmentUploads = {
  items: UploadItem[]
  /** 업로드가 끝나 전송 후 첨부할 수 있는 id (MessageComposer.pendingAttachmentIds) */
  uploadIds: string[]
  isUploading: boolean
  /** 올리는 중·완료된 파일의 총 용량(바이트) */
  totalBytes: number
  addFiles: (files: Iterable<File>) => void
  removeItem: (localId: string) => void
  /** 서버가 이미 확정한 업로드를 목록에서만 뺀다(임시 업로드를 지우지 않는다 — 새 문서 첫 저장 등 attachTo 밖의 확정 경로용) */
  forget: (uploadIds: string[]) => void
  /** 원본 이어 올리기 파일 일시정지·재개·다시 시도 — ggac 이식에서는 아무것도 하지 않는다(resumable 항목이 없다) */
  pauseItem: (localId: string) => void
  resumeItem: (localId: string) => void
  retryItem: (localId: string) => void
  /** 메시지 전송 후(onSent) 호출 — 임시 업로드를 메시지에 붙인다. 붙일 것이 없으면 null. */
  attachTo: (messageId: string) => Promise<AttachResult | null>
  /** 전송을 포기할 때 — 진행 중인 업로드를 중단하고 임시 파일을 지운다. */
  clear: () => void
  /** 파일 선택 창 열기 (MessageComposer.onAttach) */
  openFileDialog: () => void
  inputRef: RefObject<HTMLInputElement | null>
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void
  /** 서버 액션 자체가 실패했을 때의 메시지(목록 위에 표시) */
  error: string | null
}

const CONCURRENCY = 3

function newLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type PrepareResult = { ok: true; targets: UploadTarget[] } | { ok: false; error: string }

/** ① 업로드 준비 — 서버가 키·형식을 정하고 임시 업로드 행을 만든다(채널 멤버만). */
async function prepareUploadTargets(
  channelId: string,
  files: { name: string; size: number; mime: string }[]
): Promise<PrepareResult> {
  try {
    const res = await fetch(UPLOADS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'prepare', channelId, files }),
    })
    const json = (await res.json().catch(() => null)) as {
      success?: boolean
      data?: { targets?: UploadTarget[] }
      error?: string
    } | null
    if (!res.ok || !json?.success || !Array.isArray(json.data?.targets)) {
      return { ok: false, error: json?.error || '업로드를 시작하지 못했습니다.' }
    }
    return { ok: true, targets: json.data.targets }
  } catch {
    return { ok: false, error: '업로드를 시작하지 못했습니다.' }
  }
}

/** Blob SDK 오류 → 사용자 문구(원문은 개발자 도구에서만) */
function uploadErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  if (name === 'BlobFileTooLargeError') return MAX_UPLOAD_MESSAGE
  if (name === 'BlobContentTypeNotAllowedError') return '이 형식으로는 올릴 수 없습니다.'
  if (name === 'BlobClientTokenExpiredError') return '업로드 시간이 지났습니다. 다시 올려 주세요.'
  return '업로드하지 못했습니다.'
}

/**
 * 첨부 업로드 상태 머신 — 원본 kosmart-work `useAttachmentUploads`를 Vercel Blob 직접 업로드로 다시 썼다(설계 §7-2).
 * 선택 즉시 ① 준비(서버가 키·형식을 정함) → ② `@vercel/blob/client` `upload()`로 비공개 Blob 최종 키에 직접 올리고
 * (진행률 제공, 50MB 초과는 다중 조각), 메시지가 만들어지면 attachTo(messageId) 로 확정한다(서버가 `head()`로 확인).
 * 원본의 TUS 이어 올리기(일시정지·재개·새로고침 뒤 이어 올리기)는 가져오지 않았다.
 */
export function useAttachmentUploads({ channelId }: { channelId: string }): AttachmentUploads {
  const [items, setItems] = useState<UploadItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef<UploadItem[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const inputRef = useRef<HTMLInputElement | null>(null)
  const unmounted = useRef(false)
  /** attachTo 가 서버에 넘겨 처리 중인 업로드 id — 이 사이 언마운트돼도 지우지 않는다(서버가 승격 중) */
  const attaching = useRef(new Set<string>())

  const update = useCallback((fn: (prev: UploadItem[]) => UploadItem[]) => {
    const next = fn(itemsRef.current)
    itemsRef.current = next
    setItems(next)
  }, [])

  const patch = useCallback(
    (localId: string, p: Partial<UploadItem>) =>
      update(prev => prev.map(it => (it.localId === localId ? { ...it, ...p } : it))),
    [update]
  )

  // 언마운트(채널 이동 등) 시 진행 중 업로드 중단. 남은 임시 파일은 크론이 24시간 뒤 정리한다.
  useEffect(() => {
    const map = controllers.current
    const attachingIds = attaching.current
    unmounted.current = false
    return () => {
      unmounted.current = true
      for (const c of map.values()) c.abort()
      map.clear()
      // 끝까지 올라갔지만 메시지에 붙이지 않고 떠난 업로드는 임시 행·객체를 바로 지운다 — 두면 크론이 치울 때까지
      // 사용자당 임시 업로드 100개 한도를 차지한다. 전송 직후라 attachTo 가 처리 중인 id 는 건드리지 않는다.
      const leftover = itemsRef.current.flatMap(it =>
        it.status === 'done' && it.uploadId && !attachingIds.has(it.uploadId) ? [it.uploadId] : []
      )
      if (leftover.length > 0) void discardUploads(leftover).catch(() => undefined)
    }
  }, [])

  // 업로드 중 탭을 닫거나 새로고침하면 진행 중인 업로드가 끊긴다 — 이탈 경고.
  const uploading = items.some(it => it.status === 'uploading')
  useEffect(() => {
    if (!uploading) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [uploading])

  const addFiles = useCallback(
    (input: Iterable<File>) => {
      const files = Array.from(input)
      if (files.length === 0) return
      setError(null)

      const room = MAX_FILES_PER_MESSAGE - itemsRef.current.length
      const accepted: { item: UploadItem; file: File }[] = []
      const rejected: UploadItem[] = []

      files.forEach((file, i) => {
        const base = {
          localId: newLocalId(),
          name: file.name || '붙여넣은 파일',
          size: file.size,
          mime: resolveMime(file.type, file.name),
          progress: 0,
        }
        if (i >= room) {
          rejected.push({
            ...base,
            status: 'error',
            error: `한 번에 ${MAX_FILES_PER_MESSAGE}개까지 첨부할 수 있습니다.`,
          })
        } else if (file.size > MAX_FILE_BYTES) {
          rejected.push({ ...base, status: 'error', error: MAX_UPLOAD_MESSAGE })
        } else if (file.size === 0) {
          rejected.push({ ...base, status: 'error', error: '빈 파일은 올릴 수 없습니다.' })
        } else {
          accepted.push({ item: { ...base, status: 'uploading' }, file })
        }
      })

      update(prev => [...prev, ...accepted.map(a => a.item), ...rejected])
      if (accepted.length === 0) return

      void (async () => {
        const res = await prepareUploadTargets(
          channelId,
          accepted.map(({ item }) => ({ name: item.name, size: item.size, mime: item.mime }))
        )
        if (unmounted.current) {
          // 준비를 기다리는 사이 채널을 떠났다 — 올리지 않고 임시 행만 정리한다.
          if (res.ok) void discardUploads(res.targets.map(t => t.uploadId)).catch(() => undefined)
          return
        }
        if (res.ok === false) {
          setError(res.error)
          for (const { item } of accepted)
            patch(item.localId, { status: 'error', error: res.error })
          return
        }

        const byIndex = new Map(res.targets.map(t => [t.index, t] as const))
        const queue = accepted.map((a, i) => ({ ...a, target: byIndex.get(i) as UploadTarget }))
        const worker = async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const { item, file, target } = next
            if (!target) {
              patch(item.localId, { status: 'error', error: '업로드를 시작하지 못했습니다.' })
              continue
            }
            // 제거된 항목은 건너뛴다.
            if (!itemsRef.current.some(it => it.localId === item.localId)) {
              void discardUploads([target.uploadId]).catch(() => undefined)
              continue
            }
            const controller = new AbortController()
            controllers.current.set(item.localId, controller)
            try {
              // 키·형식은 서버가 정한 값 그대로 — 토큰이 그 값으로만 발급된다(무작위 접미사·덮어쓰기 없음)
              await upload(target.pathname, file, {
                access: 'private',
                handleUploadUrl: UPLOADS_ENDPOINT,
                clientPayload: target.uploadId,
                contentType: target.mime,
                multipart: target.multipart,
                abortSignal: controller.signal,
                onUploadProgress: ({ loaded, total }) =>
                  patch(item.localId, { progress: total > 0 ? loaded / total : 0 }),
              })
              patch(item.localId, { status: 'done', progress: 1, uploadId: target.uploadId })
            } catch (e) {
              // 실패·취소한 업로드의 임시 행이 남으면 24시간 동안 사용자별 상한(100건)을 갉아먹는다.
              void discardUploads([target.uploadId]).catch(() => undefined)
              const aborted =
                controller.signal.aborted ||
                (e instanceof Error && e.name === 'BlobRequestAbortedError')
              if (!aborted) {
                patch(item.localId, { status: 'error', error: uploadErrorMessage(e) })
              }
            } finally {
              controllers.current.delete(item.localId)
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      })()
    },
    [channelId, patch, update]
  )

  const removeItem = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find(it => it.localId === localId)
      if (!item) return
      controllers.current.get(localId)?.abort()
      if (item.status === 'done' && item.uploadId) {
        void discardUploads([item.uploadId]).catch(() => undefined)
      }
      update(prev => prev.filter(it => it.localId !== localId))
    },
    [update]
  )

  // 원본 이어 올리기 조작 — 이어 올리기 항목이 없어 아무것도 하지 않는다
  const pauseItem = useCallback((_localId: string) => undefined, [])
  const resumeItem = useCallback((_localId: string) => undefined, [])
  const retryItem = useCallback((_localId: string) => undefined, [])

  const forget = useCallback(
    (uploadIds: string[]) => {
      update(prev => prev.filter(it => !it.uploadId || !uploadIds.includes(it.uploadId)))
    },
    [update]
  )

  const clear = useCallback(() => {
    for (const c of controllers.current.values()) c.abort()
    const ids = itemsRef.current.flatMap(it =>
      it.status === 'done' && it.uploadId ? [it.uploadId] : []
    )
    if (ids.length > 0) void discardUploads(ids).catch(() => undefined)
    update(() => [])
    setError(null)
  }, [update])

  const attachTo = useCallback(
    async (messageId: string): Promise<AttachResult | null> => {
      const done = itemsRef.current.filter(it => it.status === 'done' && it.uploadId)
      if (done.length === 0) return null
      const ids = done.map(it => it.uploadId as string)

      for (const id of ids) attaching.current.add(id)
      const res = await attachUploads(messageId, ids)
        .catch(() => null)
        .finally(() => {
          for (const id of ids) attaching.current.delete(id)
        })
      if (!res || !res.ok) {
        // ③ 실패 시 임시 객체 정리
        void discardUploads(ids).catch(() => undefined)
        update(prev => prev.filter(it => !ids.includes(it.uploadId ?? '')))
        setError(res?.ok === false ? res.error : '첨부를 저장하지 못했습니다.')
        return null
      }

      const failedById = new Map<string, string>(res.data.failed.map(f => [f.uploadId, f.error]))
      update(prev =>
        prev.flatMap(it => {
          if (!it.uploadId || !ids.includes(it.uploadId)) return [it]
          const why = failedById.get(it.uploadId)
          return why ? [{ ...it, status: 'error' as const, uploadId: undefined, error: why }] : []
        })
      )
      if (res.data.failed.length > 0) {
        setError(`${res.data.failed.length}개 파일을 첨부하지 못했습니다.`)
      }
      return res.data
    },
    [update]
  )

  const openFileDialog = useCallback(() => inputRef.current?.click(), [])

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(Array.from(e.target.files))
      e.target.value = '' // 같은 파일을 다시 고를 수 있게
    },
    [addFiles]
  )

  return useMemo(() => {
    const uploadIds = items.flatMap(it =>
      it.status === 'done' && it.uploadId ? [it.uploadId] : []
    )
    return {
      items,
      uploadIds,
      isUploading: uploading,
      totalBytes: items.reduce((sum, it) => (it.status === 'error' ? sum : sum + it.size), 0),
      addFiles,
      removeItem,
      forget,
      pauseItem,
      resumeItem,
      retryItem,
      attachTo,
      clear,
      openFileDialog,
      inputRef,
      onInputChange,
      error,
    }
  }, [
    items,
    error,
    uploading,
    addFiles,
    removeItem,
    forget,
    pauseItem,
    resumeItem,
    retryItem,
    attachTo,
    clear,
    openFileDialog,
    onInputChange,
  ])
}
