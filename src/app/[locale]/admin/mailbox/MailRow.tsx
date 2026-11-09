import { memo } from 'react'
import { FiPaperclip } from 'react-icons/fi'

import { LabelChip } from './LabelManager'
import { formatDate } from './mailboxUtils'
import { STATUS_LABELS, isSnoozed, senderAddress, type InboundEmail } from './mailboxTypes'

/**
 * 목록의 메일 한 줄. `memo`라서 메모를 입력하는 식으로 부모가 다시 그려져도 props가 같으면(콜백은 참조가 안정적이어야
 * 한다) 다시 그려지지 않는다.
 */
function MailRow({
  email,
  isSelected,
  canManage,
  checked,
  onSelect,
  onToggle,
  onFilterSender,
}: {
  email: InboundEmail
  isSelected: boolean
  canManage: boolean
  checked: boolean
  onSelect: (email: InboundEmail) => void
  onToggle: (id: string) => void
  onFilterSender: (address: string) => void
}) {
  const statusInfo = STATUS_LABELS[email.status]
  return (
    <div
      key={email.id}
      data-mail-id={email.id}
      onClick={() => onSelect(email)}
      className={`p-3 cursor-pointer transition-colors ${
        isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {canManage && (
          <input
            type="checkbox"
            aria-label={`${email.subject || '(제목 없음)'} 선택`}
            checked={checked}
            // 행 클릭(메일 열기)으로 번지지 않게 한다.
            onClick={e => e.stopPropagation()}
            onChange={() => onToggle(email.id)}
            className="rounded border-gray-300 shrink-0"
          />
        )}
        <span className="font-medium text-gray-900 truncate min-w-0 text-sm">
          {email.subject || '(제목 없음)'}
        </span>
        {isSnoozed(email) && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 shrink-0"
            title="다시 알림"
          >
            다시 알림 {formatDate(email.snoozed_until as string)}
          </span>
        )}
        {(email.labels ?? []).map(label => (
          <LabelChip key={label.id} name={label.name} color={label.color} />
        ))}
        {email.assigned_to && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 shrink-0"
            title="담당자"
          >
            담당 {email.assignee_name ?? '탈퇴한 회원'}
          </span>
        )}
        {(email.note_count ?? 0) > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 shrink-0"
            title="내부 메모 수"
          >
            메모 {email.note_count}
          </span>
        )}
        {(email.thread_count ?? 1) > 1 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 shrink-0"
            title="같은 대화의 메일 수"
          >
            대화 {email.thread_count}
          </span>
        )}
        {(email.attachment_count ?? 0) > 0 && (
          <FiPaperclip
            className="w-3.5 h-3.5 text-gray-400 shrink-0"
            aria-label={`첨부 ${email.attachment_count}개`}
          />
        )}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
          {statusInfo.label}
        </span>
        {email.body_fetch_status === 'pending' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            본문 받는 중
          </span>
        )}
        {email.body_fetch_status === 'attachments_failed' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            첨부 받는 중
          </span>
        )}
        {email.body_fetch_status === 'attachments_expired' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            첨부 일부 누락
          </span>
        )}
        {email.body_fetch_status === 'failed' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            본문 없음
          </span>
        )}
      </div>
      <div className="mt-0.5 min-w-0">
        <button
          type="button"
          onClick={e => {
            // 행 클릭(메일 열기)으로 번지지 않게 한다.
            e.stopPropagation()
            onFilterSender(senderAddress(email))
          }}
          title={`${senderAddress(email)} 님이 보낸 메일만 보기`}
          className="max-w-full truncate text-left text-xs text-gray-500 hover:text-primary-700 hover:underline"
        >
          {email.from_name || senderAddress(email)}
        </button>
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{formatDate(email.received_at)}</div>
    </div>
  )
}

export default memo(MailRow)
