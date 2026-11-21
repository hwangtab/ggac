import { useState, useCallback, useRef } from 'react'

import type {
  Attachment,
  InboundEmailDetail,
  MailboxNote,
  SentReply,
  ThreadItem,
} from '../mailboxTypes'

/**
 * 상세 칸의 상태 — 고른 메일과 그 상세·첨부·답장·대화·메모. 읽기는 순번 + AbortController로 마지막 요청만 반영한다.
 */
export function useMailDetail({ setCanManage }: { setCanManage: (value: boolean) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null)
  // 메일별로 켜고, 다른 메일을 고르면 다시 꺼진다 — 한 번의 허용이 다음
  // 메일의 추적 픽셀까지 열어 주면 안 된다.
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [replies, setReplies] = useState<SentReply[]>([])
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [notes, setNotes] = useState<MailboxNote[]>([])
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // 상세 요청 경합 방지(j/k 연타): 마지막 요청만 상태를 바꾼다. 순번이 어긋난 응답·오류·로딩 해제는
  // 모두 버리고, 이전 요청은 abort한다. 안 그러면 메일 A의 늦은 응답이 B 헤더 아래 첨부·스레드·메모를 덮는다.
  const detailReqRef = useRef(0)
  const detailAbortRef = useRef<AbortController | null>(null)

  const fetchDetail = useCallback(
    async (id: string) => {
      const seq = ++detailReqRef.current
      detailAbortRef.current?.abort()
      const controller = new AbortController()
      detailAbortRef.current = controller
      setDetailLoading(true)
      setDetailError(null)
      try {
        const res = await fetch(`/api/admin/mailbox/${id}`, { signal: controller.signal })
        if (seq !== detailReqRef.current) return
        if (!res.ok) throw new Error('상세를 불러오지 못했습니다.')
        const json = await res.json()
        if (seq !== detailReqRef.current) return
        setDetail(json.data?.email ?? null)
        setAttachments(json.data?.attachments ?? [])
        setReplies(json.data?.replies ?? [])
        setThread(json.data?.thread ?? [])
        setNotes(json.data?.notes ?? [])
        setViewerId(json.data?.viewer_id ?? null)
        setCanManage(json.data?.can_manage === true)
      } catch (err) {
        if (seq !== detailReqRef.current || (err as Error)?.name === 'AbortError') return
        setDetailError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
      } finally {
        if (seq === detailReqRef.current) setDetailLoading(false)
      }
    },
    [setCanManage]
  )

  /** 메일을 고르고 이전 상세를 비운 뒤 새 상세를 읽는다. */
  const openDetail = useCallback(
    (id: string) => {
      setSelectedId(id)
      setDetail(null)
      setAttachments([])
      setReplies([])
      setThread([])
      setNotes([])
      setShowRemoteImages(false)
      fetchDetail(id)
    },
    [fetchDetail]
  )

  const closeDetail = useCallback(() => {
    // 닫은 뒤 늦게 도착한 상세 응답이 상태를 되살리지 못하게 진행 중 요청을 무효화한다.
    detailReqRef.current++
    detailAbortRef.current?.abort()
    setDetailLoading(false)
    setSelectedId(null)
    setDetail(null)
    setAttachments([])
    setReplies([])
    setThread([])
    setNotes([])
    setShowRemoteImages(false)
  }, [])

  return {
    selectedId,
    detail,
    setDetail,
    showRemoteImages,
    setShowRemoteImages,
    attachments,
    replies,
    thread,
    notes,
    setNotes,
    viewerId,
    detailLoading,
    detailError,
    fetchDetail,
    openDetail,
    closeDetail,
  }
}

export type MailDetailState = ReturnType<typeof useMailDetail>
