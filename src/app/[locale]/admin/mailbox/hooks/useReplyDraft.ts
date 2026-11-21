import { useState, type Dispatch, type SetStateAction } from 'react'

import { replyRecipients } from '@/lib/mail/replyCompose'

import { escapeHtml } from '../mailboxUtils'
import type { InboundEmail, InboundEmailDetail } from '../mailboxTypes'

/** 답장 창의 상태와 발송. 원본의 헤더·평문 본문은 상세 응답에만 있어 상세를 받는다. */
export function useReplyDraft({
  detail,
  selectedId,
  setEmails,
  setDetail,
  fetchEmails,
  fetchDetail,
}: {
  detail: InboundEmailDetail | null
  selectedId: string | null
  setEmails: Dispatch<SetStateAction<InboundEmail[]>>
  setDetail: Dispatch<SetStateAction<InboundEmailDetail | null>>
  fetchEmails: () => Promise<void>
  fetchDetail: (id: string) => Promise<void>
}) {
  const [replyTarget, setReplyTarget] = useState<InboundEmail | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyAll, setReplyAll] = useState(false)
  const [includeQuote, setIncludeQuote] = useState(true)

  // 답장 미리보기의 원본 — 헤더(`Reply-To`)·본문 평문은 상세 응답에만 있다. 답장은 상세에서 여므로 대개 있다.
  const replySource: InboundEmailDetail | null =
    replyTarget && detail && detail.id === replyTarget.id ? detail : null

  const openReply = (email: InboundEmail, all = false) => {
    setReplyTarget(email)
    setReplyBody('')
    setReplyAll(all)
    setIncludeQuote(true)
  }

  const closeReply = () => {
    if (replySending) return
    setReplyTarget(null)
    setReplyBody('')
  }

  const sendReply = async () => {
    if (!replyTarget || !replyBody.trim()) return
    setReplySending(true)
    try {
      // textarea 입력은 평문이지만 서버는 이것을 body_html로 받아 그대로
      // HTML로 발송한다(sanitizePostHtml은 태그를 정화할 뿐 개행을 <br>로
      // 바꿔주지 않는다). 여기서 이스케이프하고 개행을 <br>로 바꿔 보내지
      // 않으면 수신자는 문단이 통째로 붙은 메일을 받는다.
      const replyHtml = escapeHtml(replyBody).replace(/\n/g, '<br>')
      // 받는 사람은 보내지 않는다 — 서버가 같은 규칙(`replyRecipients`)으로 정한다. 화면은 미리 보여 줄 뿐이다.
      const res = await fetch(`/api/admin/mailbox/${replyTarget.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: replyHtml,
          reply_all: replyAll,
          include_quote: includeQuote && replySource?.body_text ? true : false,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // 이 저장소의 오류 응답은 { success: false, error: "<문자열>" }이다
        // (json.error가 곧 메시지 — json.error.message가 아니다).
        throw new Error(json?.error || '답장 발송에 실패했습니다.')
      }
      if (json?.data?.status === 'unknown') {
        // 요청이 Resend에 닿았는지 모른다 — 다시 보내면 같은 답장이 한 번 더 나갈 수 있다.
        setReplyTarget(null)
        setReplyBody('')
        alert(
          '답장이 나갔는지 확인할 수 없습니다. 같은 답장을 다시 보내지 말고 Resend 대시보드에서 확인해 주세요.'
        )
        return
      }
      const recorded = json?.data?.recorded ?? true
      const targetId = replyTarget.id
      setReplyTarget(null)
      setReplyBody('')
      if (recorded) {
        setEmails(prev => prev.map(e => (e.id === targetId ? { ...e, status: 'replied' } : e)))
        setDetail(prev => (prev && prev.id === targetId ? { ...prev, status: 'replied' } : prev))
        alert('답장을 보냈습니다.')
      } else {
        // 기록 실패는 같은 트랜잭션 안에서 상태 전이(updateInboundStatus)도
        // 함께 실패했을 수 있다는 뜻이다 — 낙관적으로 'replied'로 표시하면
        // 화면이 DB와 어긋날 수 있으므로 목록을 다시 읽어 실제 값을 반영한다.
        await fetchEmails()
        if (selectedId === targetId) {
          fetchDetail(targetId)
        }
        alert(
          '답장은 나갔지만 기록에 실패했습니다. 관리자에게 문의해 이 메일의 답장 기록을 확인해 주세요.'
        )
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '답장 발송에 실패했습니다.')
    } finally {
      setReplySending(false)
    }
  }

  const replyPreview = replyTarget
    ? replyRecipients(
        {
          from_address: replyTarget.from_address,
          headers: replySource?.headers,
          to_addresses: replyTarget.to_addresses,
          cc_addresses: replyTarget.cc_addresses,
          received_for: replyTarget.received_for,
        },
        { all: replyAll }
      )
    : null

  return {
    replyTarget,
    replyBody,
    setReplyBody,
    replySending,
    replyAll,
    setReplyAll,
    includeQuote,
    setIncludeQuote,
    replySource,
    replyPreview,
    openReply,
    closeReply,
    sendReply,
  }
}

export type ReplyDraft = ReturnType<typeof useReplyDraft>
