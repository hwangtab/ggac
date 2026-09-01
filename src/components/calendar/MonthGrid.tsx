'use client'

import { useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'

import { parseLocalDate, todaySeoul } from '@/utils/date'

export interface MonthGridProps {
  /** 날짜별 렌더. 'YYYY-MM-DD'를 받아 그 칸의 내용을 돌려준다. */
  renderDay: (isoDate: string) => React.ReactNode
  /** 월이 바뀌면 부모가 그 달 데이터를 다시 불러온다. 'YYYY-MM' */
  onMonthChange?: (month: string) => void
  weekdayLabels: string[]
  todayLabel: string
  prevLabel: string
  nextLabel: string
  /** 헤더에 보이는 월 라벨(예: "2026년 9월" / "September 2026")을 만든다.
   * MonthGrid는 도메인·언어를 모르므로 포맷팅은 부모가 결정한다. */
  formatMonthLabel: (visibleMonth: Date) => string
}

/** KST 기준 오늘이 속한 달의 1일. 서버(UTC)·브라우저(KST 가정)의 렌더가 갈라지지 않게 `new Date()` 대신 쓴다. */
function currentMonthSeoul() {
  return startOfMonth(parseLocalDate(todaySeoul()))
}

/**
 * 도메인 무관 월간 그리드. `startOfWeek(startOfMonth)`~`endOfWeek(endOfMonth)`(일~토) 범위라
 * 달마다 그리드가 5주 또는 6주로 다르다(고정 6주가 아니다) — 예: 2026-09은 5주. 그래서 월이
 * 바뀌면 그리드 높이도 함께 바뀔 수 있다.
 *
 * `board-room/_components/MeetingCalendar.tsx`는 그대로 둔다 — 그쪽은 select/vote 모드와
 * 정족수 배지가 이사회에 결합돼 있어 일반화하려면 그 도메인을 건드려야 한다.
 */
export default function MonthGrid({
  renderDay,
  onMonthChange,
  weekdayLabels,
  todayLabel,
  prevLabel,
  nextLabel,
  formatMonthLabel,
}: MonthGridProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => currentMonthSeoul())

  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function go(next: Date) {
    setVisibleMonth(next)
    onMonthChange?.(format(next, 'yyyy-MM'))
  }

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(subMonths(visibleMonth, 1))}
          aria-label={prevLabel}
          className="rounded px-3 py-1 hover:bg-gray-100"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{formatMonthLabel(visibleMonth)}</span>
          <button
            type="button"
            onClick={() => go(currentMonthSeoul())}
            className="rounded border px-2 py-0.5 text-xs"
          >
            {todayLabel}
          </button>
        </div>
        <button
          type="button"
          onClick={() => go(addMonths(visibleMonth, 1))}
          aria-label={nextLabel}
          className="rounded px-3 py-1 hover:bg-gray-100"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 border-b text-center text-xs text-gray-500">
        {weekdayLabels.map(w => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map(d => {
          const iso = format(d, 'yyyy-MM-dd')
          return (
            <div
              key={iso}
              className={`min-h-[84px] border-b border-r p-1 text-xs ${
                isSameMonth(d, visibleMonth) ? '' : 'bg-gray-50 text-gray-400'
              }`}
            >
              <div className="mb-1 text-right text-[11px]">{format(d, 'd')}</div>
              {renderDay(iso)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
