'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FiMail, FiEdit, FiRefreshCw } from 'react-icons/fi'

import { replyRecipients } from '@/lib/mail/replyCompose'

import ComposeModal from './ComposeModal'
import LabelManager from './LabelManager'
import RuleManager from './RuleManager'
import TemplateManager from './TemplateManager'
import SentMailbox from './SentMailbox'
import MailListPane from './MailListPane'
import MailDetailPane from './MailDetailPane'
import ReplyDialog from './ReplyDialog'
import ShortcutHelpDialog from './ShortcutHelpDialog'
import { useComposeState } from './hooks/useComposeState'
import { useMailActions } from './hooks/useMailActions'
import { useMailDetail } from './hooks/useMailDetail'
import { useMailList } from './hooks/useMailList'
import { useMailNotes } from './hooks/useMailNotes'
import { useMailboxShortcuts } from './hooks/useMailboxShortcuts'
import { useReplyDraft } from './hooks/useReplyDraft'
import { useStableCallback } from './hooks/useStableCallback'
import type { InboundEmail, SenderFilter } from './mailboxTypes'

/**
 * 관리자 메일함 화면의 본체 — `admin/mailbox`와 `board-room/mailbox`가
 * 공유한다(브리프 D). props 없이 자기 상태를 갖는다.
 *
 * `can_manage`(목록/상세 API 응답의 최상위 필드, `auth.isAdmin`에서 온다)가
 * false면 상태 변경 버튼·답장 버튼·답장 모달을 **렌더하지 않는다** — 숨기는
 * 게 아니라 안 그린다. 이사·감사는 열람만 하고 답장·상태 변경은 관리자만
 * 한다는 국장 결정(브리프 목표) 때문이다.
 *
 * 구조는 메일 클라이언트 표준 2단(좌 목록 / 우 상세)이다. 좁은 화면
 * (`lg` 미만)에서는 목록과 상세 중 하나만 보이고, 전환은 별도 상태 없이
 * `selectedId !== null`로 판정한다.
 *
 * 루트 높이는 이 컴포넌트가 정하지 않는다 — `admin/mailbox`와
 * `board-room/mailbox`가 서로 다른 레이아웃 크롬(헤더·푸터·사이드 메뉴 높이가
 * 다르다) 안에서 이 화면을 공유하므로, 고정 calc 하나로는 양쪽에 맞지
 * 않는다. 각 페이지가 `className`으로 자기 크롬에 맞는 높이를 넘긴다.
 */
export default function MailboxView({ className = '' }: { className?: string }) {
  const list = useMailList()
  const { emails, setEmails, canManage, setCanManage, fetchEmails } = list
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 발신자 규칙 창(관리자만). 발신자 카드에서 열면 그 주소로 채운다.
  const [ruleManager, setRuleManager] = useState<{
    initial?: { matchType: 'address' | 'domain'; matchValue: string }
  } | null>(null)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false)

  const detailState = useMailDetail({ setCanManage })
  const { selectedId, detail, setDetail, attachments, notes, setNotes, fetchDetail } = detailState

  const actions = useMailActions({
    emails,
    setEmails,
    setDetail,
    fetchEmails,
    fetchDetail,
    canManage,
    mineOnly: list.mineOnly,
    statusFilter: list.statusFilter,
    labelFilter: list.labelFilter,
    setLabelFilter: list.setLabelFilter,
    checkedIds: list.checkedIds,
    setCheckedIds: list.setCheckedIds,
  })
  const { labels, fetchLabels, templates, fetchTemplates, updateStatus } = actions

  // 답장 템플릿(관리자만 — 답장·새 메일 작성이 관리자만이다).
  useEffect(() => {
    if (canManage) fetchTemplates()
  }, [canManage, fetchTemplates])

  const notesState = useMailNotes({ selectedId, notes, setNotes, setEmails })
  const reply = useReplyDraft({
    detail,
    selectedId,
    setEmails,
    setDetail,
    fetchEmails,
    fetchDetail,
  })
  const compose = useComposeState({ canManage })

  // 받은 편지함 / 보낸 편지함. 보낸 편지함은 이사·감사도 열람한다.
  const [view, setView] = useState<'inbox' | 'sent'>('inbox')
  const [sentTotal, setSentTotal] = useState(0)
  const [sentRefresh, setSentRefresh] = useState(0)
  // 받은 메일 상세의 "보낸 편지함에서 보기"가 심는 검색어 — 그 보낸 메일이 목록에 바로 보이게 한다.
  const [sentSearchSeed, setSentSearchSeed] = useState<{ value: string; at: number } | null>(null)

  // `onMeta`가 SentMailbox의 effect 의존성이라 참조가 안정적이어야 한다 — 아니면 매 렌더마다 다시 읽는다.
  const handleSentMeta = useCallback(({ total }: { total: number }) => setSentTotal(total), [])

  // 담당자 지정 푸시의 링크(`?mail=<id>`)로 들어오면 그 메일을 바로 펼친다. 한 번만 쓰고 주소에서 지운다 —
  // 남겨 두면 새로고침할 때마다 같은 메일이 다시 열린다.
  useEffect(() => {
    const url = new URL(window.location.href)
    const mailId = url.searchParams.get('mail')
    if (mailId && /^[0-9a-f-]{36}$/i.test(mailId)) {
      detailState.openDetail(mailId)
    }
    if (mailId !== null) {
      url.searchParams.delete('mail')
      window.history.replaceState(null, '', url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeDetail = useCallback(() => {
    detailState.closeDetail()
    notesState.resetNoteDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailState.closeDetail, notesState.resetNoteDraft])

  const selectEmail = (email: Pick<InboundEmail, 'id' | 'status'>) => {
    detailState.openDetail(email.id)
    notesState.resetNoteDraft()
    actions.setCustomSnoozeOpen(false)

    // 안 읽음이면 읽음으로 낙관적 전이 — 열어 봤다는 사실이다. 관리 권한이
    // 없으면(이사·감사) 애초에 PATCH가 403이므로 시도하지 않는다.
    // silent: 열어 봤을 뿐인 부수 효과라 실패해도(예: 다른 관리자가 먼저
    // 읽어서 409) 경고창을 띄우지 않는다 — 명시적 상태 변경 버튼의 실패만
    // 알린다.
    if (canManage && email.status === 'unread') {
      updateStatus(email, 'read', { silent: true })
    }
  }

  const applySenderFilter = (next: SenderFilter | null) => {
    list.setSenderFilterWithHistory(next)
    // 좁은 화면에서는 상세가 목록을 가리므로 닫아야 걸린 목록이 보인다.
    closeDetail()
  }

  // 행 콜백은 참조가 안정적이어야 메모한 행이 다시 그려지지 않는다.
  const onSelectRow = useStableCallback(selectEmail)
  const onFilterSenderRow = useStableCallback((address: string) =>
    applySenderFilter({ kind: 'from', value: address })
  )

  // 대화 목록에서 연 메일은 지금 목록 페이지에 없을 수 있다 — 그때는 상세 응답을 머리글로 쓴다.
  const selectedEmail =
    emails.find(e => e.id === selectedId) ?? (detail && detail.id === selectedId ? detail : null)

  // "전체 답장"이 의미 있을 때만 버튼을 그린다 — 원본이 우리에게만 왔으면 답장과 같다.
  const selectedReplyAllCount =
    selectedEmail && detail && detail.id === selectedEmail.id
      ? (replyRecipients(
          {
            from_address: detail.from_address,
            headers: detail.headers,
            to_addresses: detail.to_addresses,
            cc_addresses: detail.cc_addresses,
            received_for: detail.received_for,
          },
          { all: true }
        )?.cc.length ?? 0)
      : 0

  const openForward = () => compose.openForward(detail, selectedId, attachments)

  const { shortcutHelpOpen, setShortcutHelpOpen } = useMailboxShortcuts({
    canManage,
    modalOpen: Boolean(
      reply.replyTarget ||
        compose.composeOpen ||
        labelManagerOpen ||
        ruleManager ||
        templateManagerOpen
    ),
    view,
    emails,
    selectedId,
    selectedEmail,
    selectedReplyAllCount,
    searchInputRef,
    selectEmail,
    closeDetail,
    toggleChecked: list.toggleChecked,
    updateStatus,
    openReply: reply.openReply,
    openForward,
  })

  return (
    <div className={`flex flex-col ${className}`}>
      {/* 헤더 — 좁은 화면에서 상세를 보고 있을 때는 접어 세로를 상세 칸에
          돌려준다(브리프: 좁은 화면은 상세가 "전체 화면"이어야 한다). 별도
          상태 없이 selectedId로 판정한다. */}
      <div
        className={`${
          selectedId !== null ? 'hidden lg:flex' : 'flex'
        } flex-wrap items-center justify-between gap-3 mb-4 shrink-0`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
            <FiMail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {view === 'inbox' ? '수신 메일함' : '보낸 편지함'}
            </h2>
            <p className="text-sm text-gray-500">
              전체 {view === 'inbox' ? list.totalCount : sentTotal}건
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="편지함 전환"
            className="flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm"
          >
            {(
              [
                ['inbox', '받은 편지함'],
                ['sent', '보낸 편지함'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => {
                  setView(key)
                  closeDetail()
                }}
                className={`whitespace-nowrap px-3 py-2 transition-colors ${
                  view === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {canManage && compose.composeEnabled && (
            <button
              onClick={() => {
                compose.openCompose()
              }}
              className="flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <FiEdit className="w-4 h-4" />새 메일
            </button>
          )}
          <button
            onClick={view === 'inbox' ? fetchEmails : () => setSentRefresh(n => n + 1)}
            className="flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCw className={`w-4 h-4 ${list.loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {list.error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm shrink-0">
          {list.error}
        </div>
      )}

      {view === 'sent' ? (
        <SentMailbox refreshKey={sentRefresh} onMeta={handleSentMeta} searchSeed={sentSearchSeed} />
      ) : (
        /* 2단 본체 */
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* 목록 칸 — 좁은 화면에서는 상세가 선택되면 숨긴다 */}
          <MailListPane
            list={list}
            actions={actions}
            labels={labels}
            selectedId={selectedId}
            composeEnabled={compose.composeEnabled}
            searchInputRef={searchInputRef}
            onSelect={onSelectRow}
            onFilterSender={onFilterSenderRow}
            onClearSenderFilter={() => applySenderFilter(null)}
            onOpenLabelManager={() => setLabelManagerOpen(true)}
            onOpenTemplateManager={() => setTemplateManagerOpen(true)}
            onOpenRuleManager={initial => setRuleManager({ initial })}
            onCompose={compose.openCompose}
          />

          {/* 상세 칸 — 좁은 화면에서는 목록이 선택되지 않았으면 숨긴다 */}
          <MailDetailPane
            selectedId={selectedId}
            selectedEmail={selectedEmail}
            detailState={detailState}
            actions={actions}
            labels={labels}
            notesState={notesState}
            canManage={canManage}
            composeEnabled={compose.composeEnabled}
            selectedReplyAllCount={selectedReplyAllCount}
            onClose={closeDetail}
            applySenderFilter={applySenderFilter}
            selectEmail={selectEmail}
            onShowSent={subject => {
              setView('sent')
              closeDetail()
              setSentSearchSeed({ value: subject, at: Date.now() })
            }}
            openReply={reply.openReply}
            openForward={openForward}
          />
        </div>
      )}

      {shortcutHelpOpen && (
        <ShortcutHelpDialog canManage={canManage} onClose={() => setShortcutHelpOpen(false)} />
      )}
      {canManage && templateManagerOpen && (
        <TemplateManager
          templates={templates}
          onClose={() => setTemplateManagerOpen(false)}
          onChanged={fetchTemplates}
        />
      )}
      {canManage && ruleManager && (
        <RuleManager
          labels={labels}
          initial={ruleManager.initial}
          onClose={() => setRuleManager(null)}
          onChanged={async () => {
            // 기존 메일에 적용했으면 상태·라벨이 바뀐다.
            await Promise.all([fetchEmails(), fetchLabels()])
          }}
        />
      )}
      {canManage && labelManagerOpen && (
        <LabelManager
          labels={labels}
          onClose={() => setLabelManagerOpen(false)}
          onChanged={async () => {
            await fetchLabels()
            // 이름·색을 바꾸거나 지우면 행의 칩도 바뀐다(지운 라벨로 거르던 것은 위 effect가 푼다).
            await fetchEmails()
            if (selectedId) await fetchDetail(selectedId)
          }}
        />
      )}
      {/* 새 메일 작성 모달 — 관리자 + 서버 스위치가 켜졌을 때만 그린다. */}
      {canManage && compose.composeEnabled && compose.composeOpen && (
        <ComposeModal
          quota={compose.composeQuota}
          initialTo={compose.composeTo}
          forward={compose.composeForward}
          templates={templates}
          onClose={compose.closeCompose}
          onDone={() => {
            setSentRefresh(n => n + 1)
            compose.fetchComposeMeta()
            fetchEmails()
          }}
        />
      )}

      {/* 답장 모달 — 관리자만 그린다. */}
      {canManage && reply.replyTarget && <ReplyDialog reply={reply} templates={templates} />}
    </div>
  )
}
