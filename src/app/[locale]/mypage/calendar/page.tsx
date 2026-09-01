'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns'

import MonthGrid from '@/components/calendar/MonthGrid'
import { Link } from '@/i18n/navigation'
import { parseLocalDate, todaySeoul } from '@/utils/date'

type CalendarItem = {
  key: string
  kind: 'grant' | 'project' | 'board'
  date: string
  time: string | null
  title: string
  url: string | null
  genres?: string[]
  regions?: string[]
}

const KIND_STYLE: Record<CalendarItem['kind'], { dot: string; label: string }> = {
  grant: { dot: 'bg-blue-500', label: '지원사업' },
  project: { dot: 'bg-green-500', label: '조합 행사' },
  board: { dot: 'bg-purple-500', label: '이사회' },
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function MyCalendarPage() {
  const [items, setItems] = useState<CalendarItem[]>([])
  const [ongoing, setOngoing] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (monthDate: Date) => {
    setLoading(true)
    setError(null)
    try {
      // MonthGrid는 6주(일~토) 고정 그리드라 앞뒤 달의 며칠을 함께 그린다
      // (gridStart/gridEnd 계산은 MonthGrid.tsx와 동일해야 하루도 안 어긋난다).
      // 달의 1일~말일만 받으면 그 앞뒤 칸은 항목이 있어도 항상 빈 칸으로 보인다.
      const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 })
      const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 })
      const from = format(gridStart, 'yyyy-MM-dd')
      const to = format(gridEnd, 'yyyy-MM-dd')
      const res = await fetch(`/api/mypage/calendar?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? '캘린더를 불러오지 못했습니다.')
      setItems(json.data.items)
      setOngoing(json.data.ongoing)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // KST 기준 오늘이 속한 달을 초기 조회한다 — MonthGrid의 초기 표시 달과 같은
    // 기준(`todaySeoul()`)을 써야 화면에 보이는 달과 실제로 불러온 데이터가 어긋나지 않는다.
    void load(parseLocalDate(todaySeoul()))
  }, [load])

  const byDate = new Map<string, CalendarItem[]>()
  for (const it of items) {
    const list = byDate.get(it.date) ?? []
    list.push(it)
    byDate.set(it.date, list)
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">내 캘린더</h1>
      <p className="mb-6 text-sm text-gray-500">
        관심 분야에 맞는 지원사업 마감일과 조합 행사·이사회 일정입니다. 관심 분야는{' '}
        <Link href="/mypage/profile" className="underline">
          프로필
        </Link>
        에서 바꿀 수 있습니다.
      </p>

      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-3 flex gap-4 text-xs text-gray-600">
        {(['grant', 'project', 'board'] as const).map(k => (
          <span key={k} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${KIND_STYLE[k].dot}`} />
            {KIND_STYLE[k].label}
          </span>
        ))}
      </div>

      <MonthGrid
        weekdayLabels={WEEKDAYS}
        todayLabel="오늘"
        prevLabel="이전 달"
        nextLabel="다음 달"
        onMonthChange={m => void load(new Date(`${m}-01T00:00:00`))}
        renderDay={iso => {
          const day = byDate.get(iso)
          if (!day || day.length === 0) return null
          return (
            <button
              type="button"
              onClick={() => setSelected(iso)}
              className="flex w-full flex-col gap-0.5 text-left"
            >
              {day.slice(0, 3).map(it => (
                <span key={it.key} className="flex items-center gap-1 truncate">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${KIND_STYLE[it.kind].dot}`}
                  />
                  <span className="truncate text-[11px]">{it.title}</span>
                </span>
              ))}
              {day.length > 3 && (
                <span className="text-[11px] text-gray-400">+{day.length - 3}</span>
              )}
            </button>
          )
        }}
      />

      {ongoing.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold">상시 모집</h2>
          <p className="mb-3 text-xs text-gray-500">
            마감일이 정해지지 않아 달력에 표시되지 않는 공고입니다.
          </p>
          <ul className="space-y-2">
            {ongoing.map(it => (
              <li key={it.key} className="rounded border p-3 text-sm">
                {it.url ? (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-blue-700 hover:underline"
                  >
                    {it.title}
                  </a>
                ) : (
                  it.title
                )}
                <span className="mt-1 block text-xs text-gray-500">
                  {[...(it.regions ?? []), ...(it.genres ?? [])].join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <p className="mt-3 text-sm text-gray-500">불러오는 중…</p>}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{selected}</h2>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-400">
                닫기
              </button>
            </div>
            <ul className="space-y-3">
              {(byDate.get(selected) ?? []).map(it => (
                <li key={it.key} className="rounded border p-3">
                  <span className="mb-1 flex items-center gap-1 text-xs text-gray-500">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${KIND_STYLE[it.kind].dot}`}
                    />
                    {KIND_STYLE[it.kind].label}
                    {it.time ? ` · ${it.time}` : ''}
                  </span>
                  {it.url ? (
                    <a
                      href={it.url}
                      target={it.url.startsWith('http') ? '_blank' : undefined}
                      rel={it.url.startsWith('http') ? 'noreferrer noopener' : undefined}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {it.title}
                    </a>
                  ) : (
                    <span className="font-medium">{it.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
