import { useMemo } from 'react'
import { FiArrowLeft, FiPaperclip, FiSend } from 'react-icons/fi'

import { snoozePresets } from '@/lib/mail/snooze'

import { LabelChip, type MailLabel } from './LabelManager'
import NotesPanel from './NotesPanel'
import type { MailActions } from './hooks/useMailActions'
import type { MailDetailState } from './hooks/useMailDetail'
import type { MailNotes } from './hooks/useMailNotes'
import { buildBodySrcDoc, formatBytes, formatDate, hasUntrustedRemoteImage } from './mailboxUtils'
import {
  ROLE_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  isSnoozed,
  senderAddress,
  senderDomain,
  type InboundEmail,
  type SenderFilter,
} from './mailboxTypes'

/**
 * 우측 상세 칸 — 머리글(담당자·다시 알림·라벨·첨부·대화)·본문 iframe·내부 메모·보낸 답장·상태 변경 막대.
 * 좁은 화면에서는 선택된 메일이 없으면 숨긴다.
 */
export default function MailDetailPane({
  selectedId,
  selectedEmail,
  detailState,
  actions,
  labels,
  notesState,
  canManage,
  composeEnabled,
  selectedReplyAllCount,
  onClose,
  applySenderFilter,
  selectEmail,
  onShowSent,
  openReply,
  openForward,
}: {
  selectedId: string | null
  selectedEmail: InboundEmail | null
  detailState: MailDetailState
  actions: MailActions
  labels: MailLabel[]
  notesState: MailNotes
  canManage: boolean
  composeEnabled: boolean
  selectedReplyAllCount: number
  onClose: () => void
  applySenderFilter: (next: SenderFilter | null) => void
  selectEmail: (email: Pick<InboundEmail, 'id' | 'status'>) => void
  /** 보낸 편지함으로 넘어가 그 제목으로 검색한다. */
  onShowSent: (subject: string) => void
  openReply: (email: InboundEmail, all?: boolean) => void
  openForward: () => void
}) {
  const {
    detail,
    attachments,
    replies,
    thread,
    notes,
    viewerId,
    detailLoading,
    detailError,
    showRemoteImages,
    setShowRemoteImages,
  } = detailState
  const {
    updating,
    updateStatus,
    snoozing,
    customSnoozeOpen,
    setCustomSnoozeOpen,
    customSnooze,
    setCustomSnooze,
    changeSnooze,
    assigneeOptions,
    assigning,
    changeAssignee,
    labelBusy,
    applyLabel,
  } = actions
  const threadInboundCount = thread.filter(item => item.kind === 'inbound').length
  // 메모를 입력할 때마다 본문 srcDoc을 다시 만들지 않게 한다.
  const bodySrcDoc = useMemo(
    () => buildBodySrcDoc(detail, showRemoteImages),
    [detail, showRemoteImages]
  )

  return (
    <div
      className={`${
        selectedId !== null ? 'flex' : 'hidden lg:flex'
      } flex-col flex-1 min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden`}
    >
      {selectedEmail === null ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          메일을 선택하세요
        </div>
      ) : (
        <>
          {/* 상세 헤더 — 고정 */}
          <div className="p-4 border-b border-gray-100 shrink-0">
            <button
              onClick={onClose}
              className="lg:hidden mb-2 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <FiArrowLeft className="w-4 h-4" />
              목록
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className="font-semibold text-gray-900 break-words line-clamp-2"
                title={selectedEmail.subject || '(제목 없음)'}
              >
                {selectedEmail.subject || '(제목 없음)'}
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[selectedEmail.status].color}`}
              >
                {STATUS_LABELS[selectedEmail.status].label}
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1 flex flex-wrap items-baseline gap-x-1 min-w-0">
              <button
                type="button"
                onClick={() =>
                  applySenderFilter({ kind: 'from', value: senderAddress(selectedEmail) })
                }
                title="이 사람이 보낸 메일만 보기"
                className="text-left break-all hover:text-primary-700 hover:underline"
              >
                {selectedEmail.from_name ? (
                  <>
                    <span className="font-medium text-gray-700">{selectedEmail.from_name}</span>{' '}
                    &lt;{senderAddress(selectedEmail)}&gt;
                  </>
                ) : (
                  senderAddress(selectedEmail)
                )}
              </button>
              {senderDomain(selectedEmail) && (
                <button
                  type="button"
                  onClick={() =>
                    applySenderFilter({
                      kind: 'domain',
                      value: senderDomain(selectedEmail) as string,
                    })
                  }
                  title="같은 기관(도메인)에서 온 메일 보기"
                  className="text-xs text-gray-400 hover:text-primary-700 hover:underline"
                >
                  @{senderDomain(selectedEmail)} 전체
                </button>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {formatDate(selectedEmail.received_at)}
            </div>
            <div
              className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600"
              data-testid="mail-assignee"
            >
              <span>
                담당:{' '}
                <span className="font-medium text-gray-800">
                  {selectedEmail.assigned_to
                    ? (selectedEmail.assignee_name ?? '탈퇴한 회원')
                    : '없음'}
                </span>
              </span>
              {canManage && assigneeOptions.length > 0 && (
                <select
                  aria-label="담당자 지정"
                  disabled={assigning}
                  value={selectedEmail.assigned_to ?? ''}
                  onChange={e => changeAssignee(selectedEmail, e.target.value || null)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                >
                  <option value="">담당자 없음</option>
                  {/* 이사에서 빠진 사람에게 남은 지정 — 후보에는 없지만 지금 값이 "없음"으로 보이면 안 된다. */}
                  {selectedEmail.assigned_to &&
                    !assigneeOptions.some(o => o.id === selectedEmail.assigned_to) && (
                      <option value={selectedEmail.assigned_to} disabled>
                        {selectedEmail.assignee_name ?? '탈퇴한 회원'} (후보 아님)
                      </option>
                    )}
                  {assigneeOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.display_name} ({ROLE_LABELS[option.role]})
                    </option>
                  ))}
                </select>
              )}
            </div>
            {(isSnoozed(selectedEmail) || canManage) && (
              <div
                className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600"
                data-testid="mail-snooze"
              >
                <span>
                  다시 알림:{' '}
                  <span className="font-medium text-gray-800">
                    {isSnoozed(selectedEmail)
                      ? formatDate(selectedEmail.snoozed_until as string)
                      : '없음'}
                  </span>
                </span>
                {canManage && isSnoozed(selectedEmail) && (
                  <button
                    type="button"
                    disabled={snoozing}
                    onClick={() => changeSnooze(selectedEmail, null)}
                    className="text-gray-500 hover:text-gray-800 hover:underline"
                  >
                    풀기
                  </button>
                )}
                {canManage && (
                  <select
                    aria-label="다시 알림 걸기"
                    disabled={snoozing}
                    value=""
                    onChange={e => {
                      const value = e.target.value
                      if (!value) return
                      if (value === 'custom') {
                        setCustomSnoozeOpen(true)
                        return
                      }
                      changeSnooze(selectedEmail, new Date(value))
                    }}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                  >
                    <option value="">다시 알림 걸기…</option>
                    {snoozePresets().map(preset => (
                      <option key={preset.key} value={preset.at.toISOString()}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">직접 고르기…</option>
                  </select>
                )}
                {canManage && customSnoozeOpen && (
                  <span className="flex items-center gap-1">
                    <input
                      type="datetime-local"
                      aria-label="다시 알림 시각"
                      value={customSnooze}
                      onChange={e => setCustomSnooze(e.target.value)}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={snoozing || !customSnooze}
                      onClick={() => changeSnooze(selectedEmail, new Date(customSnooze))}
                      className="px-2 py-0.5 rounded bg-sky-600 text-white disabled:opacity-50"
                    >
                      걸기
                    </button>
                    <span className="text-gray-400">(매시 15분에 깨웁니다)</span>
                  </span>
                )}
              </div>
            )}
            {((selectedEmail.labels ?? []).length > 0 || (canManage && labels.length > 0)) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="mail-labels">
                {(selectedEmail.labels ?? []).map(label => (
                  <LabelChip key={label.id} name={label.name} color={label.color} />
                ))}
                {canManage && labels.length > 0 && (
                  <details className="relative text-xs">
                    <summary className="cursor-pointer list-none text-gray-500 hover:text-gray-800">
                      라벨 바꾸기
                    </summary>
                    <div className="absolute z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2 shadow-lg space-y-1">
                      {labels.map(label => {
                        const on = (selectedEmail.labels ?? []).some(l => l.id === label.id)
                        return (
                          <label key={label.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              disabled={labelBusy}
                              checked={on}
                              onChange={() =>
                                applyLabel([selectedEmail.id], label.id, on ? 'remove' : 'add')
                              }
                              className="rounded border-gray-300"
                            />
                            <LabelChip name={label.name} color={label.color} />
                          </label>
                        )
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {attachments.map(att => (
                  <a
                    key={att.id}
                    href={`/api/admin/mailbox/${selectedEmail.id}/attachments/${att.id}/download`}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <FiPaperclip className="w-3 h-3 shrink-0" />
                    {att.filename}
                    {att.size_bytes !== null && (
                      <span className="text-gray-400">({formatBytes(att.size_bytes)})</span>
                    )}
                  </a>
                ))}
              </div>
            )}
            {detail?.sent_reply_to && (
              /* 우리가 새로 작성해 보낸 메일에 온 답장 — 대화(받은 메일끼리)에 넣을 수 없어 머리글에 한 줄로 잇는다. */
              <div
                data-testid="sent-reply-to"
                className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600"
              >
                <FiSend className="w-3 h-3 shrink-0 text-gray-400" />
                <span>
                  보낸 편지함의 「{detail.sent_reply_to.subject}」
                  {detail.sent_reply_to.sent_at
                    ? ` (${formatDate(detail.sent_reply_to.sent_at)})`
                    : ''}{' '}
                  메일에 온 답장으로 보입니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onShowSent(detail.sent_reply_to?.subject ?? '')
                  }}
                  className="shrink-0 px-2 py-0.5 rounded-md font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  보낸 편지함에서 보기
                </button>
              </div>
            )}
            {threadInboundCount > 1 && (
              /* 기본은 접는다 — 펼친 채로 두면 머리글이 세로를 먹어 본문 iframe이 눌린다(답장 목록과 같은 이유). */
              <details key={`thread-${selectedEmail.id}`} className="mt-2 text-xs">
                <summary className="cursor-pointer text-gray-600 font-medium">
                  이 대화의 메일 {threadInboundCount}통
                  {thread.length > threadInboundCount &&
                    ` · 우리 답장 ${thread.length - threadInboundCount}통`}
                </summary>
                <ol className="mt-1.5 max-h-40 overflow-y-auto border-l-2 border-gray-200 pl-2 space-y-0.5">
                  {thread.map(item => {
                    const targetId = item.kind === 'inbound' ? item.id : item.email_id
                    const current = item.kind === 'inbound' && item.id === selectedEmail.id
                    return (
                      <li key={`${item.kind}-${item.id}`}>
                        <button
                          type="button"
                          disabled={current}
                          aria-current={current ? 'true' : undefined}
                          onClick={() => {
                            const target = thread.find(
                              t => t.kind === 'inbound' && t.id === targetId
                            )
                            selectEmail({
                              id: targetId,
                              status: target?.kind === 'inbound' ? target.status : 'read',
                            })
                          }}
                          className={`w-full flex items-baseline gap-2 rounded px-1.5 py-1 text-left ${
                            current
                              ? 'bg-primary-50 text-primary-800 cursor-default'
                              : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span className="shrink-0 text-gray-400">
                            {item.at ? formatDate(item.at) : ''}
                          </span>
                          <span className="truncate">
                            {item.kind === 'inbound'
                              ? item.from_name || item.from_email || item.from_address
                              : '↩ 우리 답장'}
                            {item.kind === 'inbound' && item.status === 'unread' && (
                              <span className="ml-1 text-blue-600">●</span>
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </details>
            )}
          </div>

          {/* 본문 — 남는 세로 전부를 채운다 */}
          {detailLoading ? (
            <div className="flex-1 min-h-0 p-4">
              <div className="h-full bg-gray-100 rounded-lg animate-pulse" />
            </div>
          ) : detailError ? (
            <div className="flex-1 min-h-0 p-4 text-sm text-red-600">{detailError}</div>
          ) : (
            /*
                  받은 메일의 HTML은 외부에서 온 것이다. 화면 DOM에 직접 넣으면
                  세션을 노린 XSS 통로가 된다. 수신 본문 경로에는 서버 정화가
                  없다(`sanitizePostHtml`은 답장 발신 경로 전용) — 실제 방어는
                  sandbox 하나뿐이고, allow-scripts를 주지 않아 스크립트를 아예 못
                  돌게 하는 것으로 충분하다. allow-popups는 본문 링크를 새 탭으로
                  여는 데만 쓰이며 스크립트 실행과 무관하다 — 그것이 없으면 클릭이
                  아무 반응도 하지 않는다. 다만 sandbox는 서브리소스 로드까지 막지는
                  않으므로 buildBodySrcDoc()이 CSP 메타로 원격 이미지(추적 픽셀)를
                  추가로 막는다 — 그 메타 덕분에 인라인 이미지(html_format=data_uri로
                  base64 첨부)와 우리 출처 이미지만 보이고 그 밖의 외부 요청은
                  "이미지 표시"를 누르기 전에는 나가지 않는다.
                */
            <>
              {hasUntrustedRemoteImage(detail?.body_html) && (
                <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-100 shrink-0">
                  <span>
                    {showRemoteImages
                      ? '이 메일의 외부 이미지를 표시하고 있습니다. 발신자가 열람 사실을 알 수 있습니다.'
                      : '외부 이미지를 차단했습니다. 표시하면 발신자가 열람 사실을 알 수 있습니다.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowRemoteImages(v => !v)}
                    className="shrink-0 px-2.5 py-1 rounded-md font-medium bg-white border border-amber-300 hover:bg-amber-100"
                  >
                    {showRemoteImages ? '이미지 숨기기' : '이미지 표시'}
                  </button>
                </div>
              )}
              <iframe
                title="메일 본문"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={bodySrcDoc}
                className="w-full flex-1 min-h-[12rem] bg-white"
              />
              <NotesPanel
                emailId={selectedEmail.id}
                notes={notes}
                viewerId={viewerId}
                canManage={canManage}
                state={notesState}
              />
              {replies.length > 0 && (
                /*
                        기본은 접어 둔다. 펼쳐 둔 채로 두면 이 영역이 세로를 먹어 본문 iframe이 거의 0으로 눌린다
                        (E2E가 잡았다 — 답장이 달린 메일의 본문이 안 보였다). 메일을 바꾸면 key가 달라 다시 접힌다.
                      */
                <details
                  key={selectedEmail.id}
                  className="shrink-0 border-t border-gray-100 bg-gray-50"
                >
                  <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-gray-600">
                    보낸 답장 {replies.length}건
                  </summary>
                  <div className="max-h-48 overflow-y-auto">
                    {replies.map(reply => (
                      <div key={reply.id} className="px-4 py-3 border-t border-gray-100">
                        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                          <span className="truncate font-medium text-gray-700">
                            {reply.subject}
                          </span>
                          <span className="shrink-0">
                            {new Date(reply.created_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                        {/* 서버가 정화해 저장한 HTML이지만 수신 본문과 같은 sandbox에 가둔다. */}
                        <iframe
                          title={`보낸 답장 ${reply.subject}`}
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                          srcDoc={buildBodySrcDoc({ body_html: reply.body_html }, false)}
                          className="mt-2 w-full h-28 bg-white rounded border border-gray-100"
                        />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {/* 상태 변경 + 답장 버튼 — 관리자만. 이사·감사는 열람만 한다
                  (브리프 목표). canManage가 false면 그리지 않는다 — 숨기는
                  게 아니라 안 그린다. */}
          {canManage && (
            <div className="flex items-center gap-2 p-3 border-t border-gray-100 flex-wrap shrink-0">
              <span className="text-sm text-gray-500 mr-1">상태 변경:</span>
              {STATUS_ORDER.map(s => (
                <button
                  key={s}
                  disabled={updating === selectedEmail.id || selectedEmail.status === s}
                  onClick={() => updateStatus(selectedEmail, s)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:opacity-80 ${STATUS_LABELS[s].color}`}
                >
                  {STATUS_LABELS[s].label}
                </button>
              ))}
              <span className="flex-1" />
              <button
                onClick={() => openReply(selectedEmail)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
              >
                <FiSend className="w-3 h-3" />
                답장
              </button>
              {composeEnabled && detail && detail.id === selectedEmail.id && (
                <button
                  onClick={openForward}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  <FiSend className="w-3 h-3" />
                  전달
                </button>
              )}
              {selectedReplyAllCount > 0 && (
                <button
                  onClick={() => openReply(selectedEmail, true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  <FiSend className="w-3 h-3" />
                  전체 답장
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
