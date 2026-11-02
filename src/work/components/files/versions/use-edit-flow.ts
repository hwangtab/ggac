'use client'

import { useCallback, useState } from 'react'
import { checkoutFile } from '@work/lib/files/version-actions'
import type { FileVersionState } from '@work/lib/files/version-rules'
import { fileUrl } from '../FilePreviewBody'
import {
  deleteEditBase,
  deleteEditHandle,
  loadEditBase,
  loadEditHandle,
  notifyEditChanged,
  pickSaveHandle,
  saveEditBase,
  saveEditHandle,
  supportsFileSystemAccess,
  type EditFileHandle,
} from './edit-handles'

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 서명 URL 의 바이트를 선택한 파일 핸들에 스트리밍으로 쓴다(큰 파일도 메모리에 올리지 않는다) */
async function writeUrlToHandle(handle: EditFileHandle, url: string): Promise<void> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const writable = await handle.createWritable()
  await res.body.pipeTo(writable)
}

/** 브라우저 기본 내려받기 */
function anchorDownload(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** "내 PC에서 수정"이 받는 버전 — 옛 버전을 보고 있어도 항상 계보의 최신본(옛 버전 기준 수정 방지) */
function editTargetId(s: FileVersionState): string {
  return s.latestId ?? s.attachmentId
}

export type HeldPrompt = {
  heldByName: string | null
  since: string
}

/**
 * "내 PC에서 수정" — 수정 중 표시(checkoutFile) + 내려받기.
 * File System Access API 가 있으면(크롬·엣지) 저장 위치를 고르게 하고 핸들을 IndexedDB 에 보관해 "수정본 올리기"가
 * 파일 고르기 없이 바로 읽게 한다. 없으면 기존 `/api/files/<id>?download=1`.
 * 저장 위치 창은 사용자 클릭 직후에만 열 수 있어 서버 호출보다 먼저 띄운다(취소하면 수정 중으로 표시하지 않는다).
 */
export function useBeginEdit(state: FileVersionState | null, fileName: string) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [held, setHeld] = useState<(HeldPrompt & { handle: EditFileHandle | null }) | null>(null)

  const finish = useCallback(
    async (s: FileVersionState, handle: EditFileHandle | null) => {
      const url = fileUrl(editTargetId(s), { download: true })
      let usedFs = false
      if (handle) {
        try {
          await writeUrlToHandle(handle, url)
          usedFs = await saveEditHandle(s.rootId, handle)
        } catch (e) {
          console.error('[edit] 파일 핸들 쓰기 실패 — 일반 내려받기로 대신합니다:', e)
        }
      }
      if (!usedFs) {
        await deleteEditHandle(s.rootId)
        anchorDownload(url, fileName)
      }
      saveEditBase(s.rootId, editTargetId(s))
      notifyEditChanged()
      setMessage(
        usedFs
          ? '선택한 위치에 저장했습니다. 고친 뒤 “수정본 올리기”를 누르세요.'
          : '내려받았습니다. 고친 뒤 “수정본 올리기”로 올려 주세요.'
      )
    },
    [fileName]
  )

  const begin = useCallback(async () => {
    if (!state || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const handle = supportsFileSystemAccess() ? await pickSaveHandle(fileName) : undefined
      if (handle === null) return // 사용자가 저장 위치 선택을 취소
      const res = await checkoutFile({ attachmentId: editTargetId(state) })
      if (!res.ok) {
        setMessage(res.error)
        return
      }
      if (res.data.status === 'held') {
        setHeld({
          heldByName: res.data.heldBy.userName,
          since: res.data.since,
          handle: handle ?? null,
        })
        return
      }
      await finish(state, handle ?? null)
    } catch {
      setMessage(NETWORK_ERROR)
    } finally {
      setBusy(false)
    }
  }, [state, busy, fileName, finish])

  const confirmHeld = useCallback(async () => {
    const prompt = held
    if (!prompt || !state) return
    setHeld(null)
    setBusy(true)
    try {
      const res = await checkoutFile({ attachmentId: editTargetId(state), force: true })
      if (!res.ok) {
        setMessage(res.error)
        return
      }
      await finish(state, prompt.handle)
    } catch {
      setMessage(NETWORK_ERROR)
    } finally {
      setBusy(false)
    }
  }, [held, state, finish])

  const cancelHeld = useCallback(() => setHeld(null), [])

  return { begin, busy, message, held, confirmHeld, cancelHeld }
}

export type UploadEditedDialogState = {
  open: boolean
  /** 보관된 파일 핸들에서 읽은 수정본(있으면 고르기 없이 자동 저장) */
  file: File | null
  /** 저장 대화상자를 열 때 쓸 기준 버전(내가 받은 버전) */
  baseAttachmentId: string
}

/**
 * "수정본 올리기" 진입 — 핸들이 있으면 권한을 확인하고 getFile() 로 바로 읽어 자동 저장,
 * 없으면 파일 선택 대화상자. base(내가 받은 버전)는 내려받을 때 남긴 기록을 쓰고 없으면 열어 본 버전을 쓴다.
 */
export function useUploadEdited(rootId: string | null, fallbackBaseId: string | null) {
  const [dialog, setDialog] = useState<UploadEditedDialogState>({
    open: false,
    file: null,
    baseAttachmentId: '',
  })
  const [message, setMessage] = useState<string | null>(null)

  const start = useCallback(async () => {
    if (!rootId) return
    setMessage(null)
    const baseAttachmentId = loadEditBase(rootId) ?? fallbackBaseId ?? ''
    if (!baseAttachmentId) {
      setMessage('기준 버전을 찾지 못했습니다. 파일을 새로 열어 다시 시도해 주세요.')
      return
    }
    let file: File | null = null
    const handle = await loadEditHandle(rootId)
    if (handle) {
      try {
        const perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'granted'
        if (perm === 'granted') file = await handle.getFile()
      } catch (e) {
        // 파일이 옮겨졌거나 지워졌거나 권한을 거절 — 파일 선택으로 대신한다
        console.warn('[edit] 보관된 파일 핸들을 읽지 못했습니다:', e)
      }
    }
    setDialog({ open: true, file, baseAttachmentId })
  }, [rootId, fallbackBaseId])

  /** 기준 버전을 직접 정해(새 버전 올리기) 파일 선택 대화상자를 연다 */
  const startFresh = useCallback((baseAttachmentId: string) => {
    setMessage(null)
    setDialog({ open: true, file: null, baseAttachmentId })
  }, [])

  const setOpen = useCallback((open: boolean) => setDialog(d => ({ ...d, open })), [])

  /** 저장이 끝난 뒤 — 핸들·기준 기록을 지우고 다른 컴포넌트에 알린다 */
  const afterSaved = useCallback(async () => {
    if (rootId) {
      await deleteEditHandle(rootId)
      deleteEditBase(rootId)
    }
    notifyEditChanged()
  }, [rootId])

  return { dialog, setOpen, start, startFresh, message, afterSaved }
}
