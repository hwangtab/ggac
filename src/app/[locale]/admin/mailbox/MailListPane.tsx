import { useMemo, type RefObject } from 'react'
import { FiEdit, FiUser, FiX } from 'react-icons/fi'

import { labelColorClass } from '@/lib/mail/labels'

import AdvancedSearchBar from './AdvancedSearchBar'
import MailRow from './MailRow'
import type { MailLabel } from './LabelManager'
import type { MailActions } from './hooks/useMailActions'
import type { MailList } from './hooks/useMailList'
import { formatDate } from './mailboxUtils'
import {
  LIMIT,
  REGISTRATION_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  type InboundEmail,
} from './mailboxTypes'

/**
 * 좌측 목록 칸 — 검색·거르기·일괄 처리 막대·메일 줄·페이지 넘김. 행은 `MailRow`(memo)라서 콜백 props는 참조가
 * 안정적이어야 한다.
 */
export default function MailListPane({
  list,
  actions,
  labels,
  selectedId,
  composeEnabled,
  searchInputRef,
  onSelect,
  onFilterSender,
  onClearSenderFilter,
  onOpenLabelManager,
  onOpenTemplateManager,
  onOpenRuleManager,
  onCompose,
}: {
  list: MailList
  actions: MailActions
  labels: MailLabel[]
  selectedId: string | null
  composeEnabled: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  onSelect: (email: InboundEmail) => void
  onFilterSender: (address: string) => void
  onClearSenderFilter: () => void
  onOpenLabelManager: () => void
  onOpenTemplateManager: () => void
  onOpenRuleManager: (initial?: { matchType: 'address' | 'domain'; matchValue: string }) => void
  onCompose: (to: string[]) => void
}) {
  const {
    emails,
    loading,
    canManage,
    checkedIds,
    setCheckedIds,
    toggleChecked,
    senderFilter,
    senderCard,
    statusFilter,
    mineOnly,
    snoozedOnly,
    labelFilter,
    offset,
    setOffset,
    totalCount,
  } = list
  const { labelBusy, bulkUpdating, applyLabel, bulkUpdate, bulkDelete } = actions

  const filterButtons: { key: string; label: string }[] = [
    { key: 'all', label: '전체' },
    ...STATUS_ORDER.map(s => ({ key: s, label: STATUS_LABELS[s].label })),
  ]
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])
  const page = Math.floor(offset / LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT))

  return (
    <div
      className={`${
        selectedId !== null ? 'hidden lg:flex' : 'flex'
      } flex-col w-full lg:w-1/3 lg:max-w-sm min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden`}
    >
      {/* 검색 + 필터 */}
      <div className="p-3 border-b border-gray-100 space-y-3 shrink-0">
        <AdvancedSearchBar
          inputRef={searchInputRef}
          searchInput={list.searchInput}
          onSearchInputChange={list.setSearchInput}
          onSearch={list.runSearch}
          showAdvanced={list.showAdvanced}
          onToggleAdvanced={() => list.setShowAdvanced(v => !v)}
          hasAttachment={list.hasAttachment}
          afterDate={list.afterDate}
          beforeDate={list.beforeDate}
          onChange={list.changeAdvanced}
        />
        {senderFilter && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full pl-2.5 pr-1 py-1 text-xs rounded-full bg-primary-50 text-primary-800 border border-primary-200">
              <FiUser className="w-3 h-3 shrink-0" />
              <span className="shrink-0">
                {senderFilter.kind === 'from' ? '보낸 사람' : '보낸 기관'}
              </span>
              <span className="font-medium truncate" title={senderFilter.value}>
                {senderFilter.kind === 'domain' ? `@${senderFilter.value}` : senderFilter.value}
              </span>
              <button
                type="button"
                onClick={() => onClearSenderFilter()}
                aria-label="보낸 사람 필터 해제"
                className="p-0.5 rounded-full hover:bg-primary-100 shrink-0"
              >
                <FiX className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
        {senderCard && (
          <div
            data-testid="sender-card"
            className="rounded-lg border border-gray-200 p-2.5 text-xs text-gray-600 space-y-1"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {senderCard.sender.name && (
                  <div className="font-medium text-gray-900 truncate">{senderCard.sender.name}</div>
                )}
                <div className="truncate">{senderCard.sender.email}</div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenRuleManager({ matchType: 'address', matchValue: senderCard.sender.email })
                  }
                  className="shrink-0 px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
                >
                  규칙 만들기
                </button>
              )}
              {canManage && composeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    onCompose([senderCard.sender.email])
                  }}
                  className="flex items-center gap-1 shrink-0 px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
                >
                  <FiEdit className="w-3 h-3" />
                  메일 쓰기
                </button>
              )}
            </div>
            <div>
              받은 메일 {senderCard.sender.inbound_count}통 · 답장 {senderCard.sender.reply_count}통
              · 보낸 메일 {senderCard.sender.sent_count}통
            </div>
            {senderCard.sender.first_received_at && senderCard.sender.last_received_at && (
              <div className="text-gray-400">
                처음 {formatDate(senderCard.sender.first_received_at)} · 최근{' '}
                {formatDate(senderCard.sender.last_received_at)}
              </div>
            )}
            <div>
              {senderCard.member ? (
                <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                  회원 {senderCard.member.display_name}
                  {senderCard.member.registration_status !== 'approved' &&
                    ` (${REGISTRATION_LABELS[senderCard.member.registration_status] ?? senderCard.member.registration_status})`}
                  {senderCard.member.registration_status === 'approved' &&
                    !senderCard.member.is_active &&
                    ' (비활성)'}
                </span>
              ) : (
                <span className="text-gray-400">가입한 회원 주소가 아닙니다</span>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 flex-wrap">
          {filterButtons.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                list.changeStatusFilter(key)
              }}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                statusFilter === key
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={mineOnly}
            onClick={() => {
              list.toggleMineOnly()
            }}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              mineOnly
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            내 담당
          </button>
          <button
            type="button"
            aria-pressed={snoozedOnly}
            onClick={() => {
              list.toggleSnoozedOnly()
            }}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              snoozedOnly
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            다시 알림
          </button>
        </div>
        {(labels.length > 0 || canManage) && (
          <div className="flex gap-1.5 flex-wrap items-center" data-testid="label-filters">
            {labels.map(label => (
              <button
                key={label.id}
                type="button"
                aria-pressed={labelFilter === label.id}
                onClick={() => {
                  list.toggleLabelFilter(label.id)
                }}
                className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${labelColorClass(
                  label.color
                )} ${
                  labelFilter === label.id
                    ? 'border-gray-800 ring-1 ring-gray-800'
                    : 'border-transparent opacity-80 hover:opacity-100'
                }`}
              >
                {label.name}
                <span className="ml-1 text-[10px] opacity-70">{label.email_count}</span>
              </button>
            ))}
            {canManage && (
              <button
                type="button"
                onClick={() => onOpenLabelManager()}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:underline"
              >
                라벨 관리
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => onOpenTemplateManager()}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:underline"
              >
                답장 템플릿
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => onOpenRuleManager()}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:underline"
              >
                발신자 규칙
              </button>
            )}
          </div>
        )}
      </div>

      {canManage && emails.length > 0 && (
        <div
          data-testid="bulk-toolbar"
          className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-100 bg-gray-50 text-xs shrink-0"
        >
          <label className="flex items-center gap-1.5 text-gray-600 mr-1">
            <input
              type="checkbox"
              aria-label="이 페이지 전체 선택"
              checked={checkedIds.length > 0 && checkedIds.length === emails.length}
              ref={el => {
                if (el) {
                  el.indeterminate = checkedIds.length > 0 && checkedIds.length < emails.length
                }
              }}
              onChange={e => setCheckedIds(e.target.checked ? emails.map(m => m.id) : [])}
              className="rounded border-gray-300"
            />
            {checkedIds.length > 0 ? `${checkedIds.length}개 선택` : '전체 선택'}
          </label>
          {checkedIds.length > 0 && labels.length > 0 && (
            <select
              aria-label="고른 메일에 라벨 붙이기"
              disabled={labelBusy}
              value=""
              onChange={async e => {
                const labelId = e.target.value
                if (!labelId) return
                const ok = await applyLabel(
                  emails.filter(m => checkedIds.includes(m.id)).map(m => m.id),
                  labelId,
                  'add'
                )
                if (ok) setCheckedIds([])
              }}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-1"
            >
              <option value="">라벨 붙이기…</option>
              {labels.map(label => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          )}
          {checkedIds.length > 0 &&
            (['read', 'unread', 'archived', 'spam'] as const).map(s => (
              <button
                key={s}
                type="button"
                disabled={bulkUpdating}
                onClick={() => bulkUpdate(s)}
                className={`px-2 py-1 rounded-md font-medium disabled:opacity-50 hover:opacity-80 ${STATUS_LABELS[s].color}`}
              >
                {STATUS_LABELS[s].label}
              </button>
            ))}
          {checkedIds.length > 0 && (
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={bulkDelete}
              className="px-2 py-1 rounded-md font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              title="선택한 메일을 완전히 지웁니다(첨부 포함, 되돌릴 수 없음)"
            >
              삭제
            </button>
          )}
        </div>
      )}
      {/* 목록 — 독립 스크롤 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="py-16 text-center text-gray-500 text-sm">수신 메일이 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {emails.map(email => (
              <MailRow
                key={email.id}
                email={email}
                isSelected={selectedId === email.id}
                canManage={canManage}
                checked={checkedSet.has(email.id)}
                onSelect={onSelect}
                onToggle={toggleChecked}
                onFilterSender={onFilterSender}
              />
            ))}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {!loading && totalCount > LIMIT && (
        <div className="flex items-center justify-center gap-3 py-2 border-t border-gray-100 shrink-0">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            이전
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            disabled={offset + LIMIT >= totalCount}
            onClick={() => setOffset(offset + LIMIT)}
            className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
  )
}
