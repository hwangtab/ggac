import type { RefObject } from 'react'
import { FiSearch, FiSliders } from 'react-icons/fi'

import { inputClass } from './mailboxTypes'

type AdvancedPatch = { hasAttachment?: boolean; afterDate?: string; beforeDate?: string }

/** 목록 위의 검색창과 상세 검색(첨부·기간) 패널. */
export default function AdvancedSearchBar({
  inputRef,
  searchInput,
  onSearchInputChange,
  onSearch,
  showAdvanced,
  onToggleAdvanced,
  hasAttachment,
  afterDate,
  beforeDate,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearch: () => void
  showAdvanced: boolean
  onToggleAdvanced: () => void
  hasAttachment: boolean
  afterDate: string
  beforeDate: string
  onChange: (patch: AdvancedPatch) => void
}) {
  const advancedCount = (hasAttachment ? 1 : 0) + (afterDate ? 1 : 0) + (beforeDate ? 1 : 0)

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={searchInput}
          onChange={e => onSearchInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSearch()
          }}
          placeholder="제목 또는 보낸 사람 검색"
          className={inputClass}
        />
        <button
          onClick={onSearch}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
        >
          <FiSearch className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-expanded={showAdvanced}
          aria-label="상세 검색"
          title="상세 검색"
          className={`relative flex items-center px-3 py-2 text-sm border rounded-lg transition-colors shrink-0 ${
            showAdvanced
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-white border-gray-300 hover:bg-gray-50'
          }`}
        >
          <FiSliders className="w-4 h-4" />
          {advancedCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary-600 text-white text-[10px] leading-4 text-center">
              {advancedCount}
            </span>
          )}
        </button>
      </div>
      {showAdvanced && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hasAttachment}
              onChange={e => onChange({ hasAttachment: e.target.checked })}
              className="rounded border-gray-300"
            />
            첨부가 있는 메일만
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0">받은 날</span>
            <input
              type="date"
              aria-label="받은 날 시작"
              value={afterDate}
              max={beforeDate || undefined}
              onChange={e => onChange({ afterDate: e.target.value })}
              className="rounded border border-gray-300 px-1.5 py-1"
            />
            <span>~</span>
            <input
              type="date"
              aria-label="받은 날 끝"
              value={beforeDate}
              min={afterDate || undefined}
              onChange={e => onChange({ beforeDate: e.target.value })}
              className="rounded border border-gray-300 px-1.5 py-1"
            />
          </div>
          {advancedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange({ hasAttachment: false, afterDate: '', beforeDate: '' })
              }}
              className="text-primary-700 hover:underline"
            >
              조건 지우기
            </button>
          )}
        </div>
      )}
    </>
  )
}
