'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { PencilLineIcon } from 'lucide-work'
import { listMyCheckouts, releaseCheckout } from '@work/lib/files/version-actions'
import type { MyCheckoutItem } from '@work/lib/files/version-schema'
import { formatSinceLabel } from '@work/lib/files/version-rules'
import {
  deleteEditBase,
  deleteEditHandle,
  EDIT_CHANGED_EVENT,
  notifyEditChanged,
} from './edit-handles'
import SaveVersionDialog from './SaveVersionDialog'
import { useUploadEdited } from './use-edit-flow'

const rowButton = 'rounded-w-lg px-1.5 py-0.5 text-xs outline-none hover:bg-sidebar-accent/60'

function EditingRow({ item, onChanged }: { item: MyCheckoutItem; onChanged: () => void }) {
  const router = useRouter()
  const up = useUploadEdited(item.rootId, item.attachmentId)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    setError(null)
    try {
      const res = await releaseCheckout({ attachmentId: item.attachmentId })
      if (!res.ok) {
        setError(res.error)
        return
      }
      await deleteEditHandle(item.rootId)
      deleteEditBase(item.rootId)
      notifyEditChanged()
      onChanged()
    } catch {
      setError('취소하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <li className="rounded-w-lg px-3 py-1.5 text-sm">
      <p className="truncate font-medium" title={item.name}>
        {item.name}
      </p>
      <p className="truncate text-xs text-sidebar-foreground/70">
        # {item.channelName} · {formatSinceLabel(item.since)}부터
      </p>
      <div className="mt-0.5 flex items-center gap-1">
        <button
          type="button"
          className={rowButton}
          aria-label={`${item.name} 수정본 올리기`}
          onClick={() => void up.start()}
        >
          수정본 올리기
        </button>
        <button
          type="button"
          className={rowButton}
          aria-label={`${item.name} 수정 취소`}
          onClick={() => void cancel()}
        >
          취소
        </button>
      </div>
      {(error ?? up.message) && (
        <p role="alert" className="text-xs text-destructive">
          {error ?? up.message}
        </p>
      )}
      <SaveVersionDialog
        open={up.dialog.open}
        onOpenChange={up.setOpen}
        channelId={item.channelId}
        baseAttachmentId={up.dialog.baseAttachmentId}
        fileName={item.name}
        initialFile={up.dialog.file}
        onSaved={async () => {
          await up.afterSaved()
          router.refresh()
        }}
      />
    </li>
  )
}

/**
 * 자료실 목록 패널 맨 위 "내가 수정 중인 파일" 구역(docs/09 §3-2). 있을 때만 보인다 — 파일명·채널·시작 시각·
 * [수정본 올리기]·[취소]. 8시간이 지나면 서버가 거르므로 사라진다. 수정 시작·취소·저장 신호(EDIT_CHANGED_EVENT)로 다시 읽는다.
 */
export default function MyEditingSection() {
  const [items, setItems] = useState<MyCheckoutItem[]>([])
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    window.addEventListener(EDIT_CHANGED_EVENT, reload)
    return () => window.removeEventListener(EDIT_CHANGED_EVENT, reload)
  }, [reload])

  useEffect(() => {
    let cancelled = false
    listMyCheckouts()
      .then(res => {
        if (!cancelled) setItems(res.ok ? res.data : [])
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  if (items.length === 0) return null
  return (
    <section aria-label="내가 수정 중인 파일">
      <h3 className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/70">
        <PencilLineIcon aria-hidden="true" className="size-3.5" />
        내가 수정 중인 파일
      </h3>
      <ul className="space-y-px">
        {items.map(it => (
          <EditingRow key={it.rootId} item={it} onChanged={reload} />
        ))}
      </ul>
    </section>
  )
}
