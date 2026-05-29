'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isBefore,
  startOfDay,
  addMonths,
  subMonths,
  parseISO,
} from 'date-fns'
import { BOARD_MEETING_TIME } from '@/constants/boardRoom'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DateOption {
  id: string
  candidate_date: string
}

interface Vote {
  option_id: string
  voter_id: string
  is_available: boolean
}

interface RosterMember {
  id: string
  display_name: string
  director_title: string | null
}

type SelectModeProps = {
  mode: 'select'
  selectedDates: string[]
  onToggleDate: (date: string) => void
  minDate?: string
}

type VoteModeProps = {
  mode: 'vote'
  options: DateOption[]
  votes: Vote[]
  roster: RosterMember[]
  currentUserId: string
  votingClosed: boolean
  onVote: (optionId: string, isAvailable: boolean) => void | Promise<void>
  /** Admin-only: passing this enables the per-candidate confirm action */
  onConfirm?: (date: string) => void | Promise<void>
}

type MeetingCalendarProps = SelectModeProps | VoteModeProps

const DATE_KEY = 'yyyy-MM-dd'
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// ─── Component ────────────────────────────────────────────────────────────────

export default function MeetingCalendar(props: MeetingCalendarProps) {
  const t = useTranslations('boardRoom.calendar')

  // Anchor the visible month sensibly per mode.
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    if (props.mode === 'vote') {
      const first = [...props.options]
        .map(o => o.candidate_date)
        .sort()
        .find(Boolean)
      if (first) return startOfMonth(parseISO(first))
    } else if (props.mode === 'select' && props.selectedDates.length > 0) {
      return startOfMonth(parseISO([...props.selectedDates].sort()[0]))
    }
    return startOfMonth(new Date())
  })

  const today = startOfDay(new Date())

  // Build the 6-week (max) grid spanning whole weeks (Sun–Sat).
  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  // ── Mode-specific lookups ───────────────────────────────────────────────
  const selectedSet = props.mode === 'select' ? new Set(props.selectedDates) : new Set<string>()

  const optionByDate =
    props.mode === 'vote'
      ? new Map(props.options.map(o => [o.candidate_date, o] as const))
      : new Map<string, DateOption>()

  const minDateFloor =
    props.mode === 'select' && props.minDate ? startOfDay(parseISO(props.minDate)) : today

  const goPrev = () => setVisibleMonth(m => subMonths(m, 1))
  const goNext = () => setVisibleMonth(m => addMonths(m, 1))
  const goToday = () => setVisibleMonth(startOfMonth(new Date()))

  return (
    <div className="select-none">
      {/* Header: month nav */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goPrev}
          aria-label={t('prevMonth')}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{format(visibleMonth, 'yyyy.MM')}</h3>
          <button
            type="button"
            onClick={goToday}
            className="text-xs text-gray-400 hover:text-primary-600 transition-colors"
          >
            {t('today')}
          </button>
        </div>
        <button
          type="button"
          onClick={goNext}
          aria-label={t('nextMonth')}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          ›
        </button>
      </div>

      {/* Meeting time hint */}
      <p className="text-xs text-gray-500 mb-2">{t('timeHint', { time: BOARD_MEETING_TIME })}</p>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_KEYS.map((key, i) => (
          <div
            key={key}
            className={`text-center text-[11px] font-medium py-1 ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            {t(`weekday.${key}`)}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const key = format(day, DATE_KEY)
          const inMonth = isSameMonth(day, visibleMonth)
          const isToday = isSameDay(day, today)
          const weekday = day.getDay()

          // ── SELECT MODE ─────────────────────────────────────────────
          if (props.mode === 'select') {
            const past = isBefore(startOfDay(day), minDateFloor)
            const selected = selectedSet.has(key)
            const disabled = past

            return (
              <button
                type="button"
                key={key}
                disabled={disabled}
                onClick={() => props.onToggleDate(key)}
                aria-pressed={selected}
                className={[
                  'relative aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-colors',
                  disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'cursor-pointer hover:bg-primary-50',
                  !inMonth && !disabled ? 'text-gray-400' : '',
                  selected
                    ? 'bg-primary-600 text-white hover:bg-primary-600 font-semibold shadow-sm'
                    : inMonth && !disabled
                      ? weekday === 0
                        ? 'text-red-500'
                        : weekday === 6
                          ? 'text-blue-500'
                          : 'text-gray-900'
                      : '',
                ].join(' ')}
              >
                <span>{format(day, 'd')}</span>
                {isToday && !selected && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary-500" />
                )}
                {selected && (
                  <span className="text-[9px] leading-none mt-0.5 opacity-90">
                    {BOARD_MEETING_TIME}
                  </span>
                )}
              </button>
            )
          }

          // ── VOTE MODE ───────────────────────────────────────────────
          const option = optionByDate.get(key)
          if (!option) {
            // Not a candidate day — dimmed, inert
            return (
              <div
                key={key}
                className={`aspect-square rounded-lg flex items-center justify-center text-sm ${
                  inMonth ? 'text-gray-300' : 'text-gray-200'
                }`}
              >
                <span>{format(day, 'd')}</span>
                {isToday && <span className="sr-only">{t('today')}</span>}
              </div>
            )
          }

          const optionVotes = props.votes.filter(v => v.option_id === option.id)
          const availableVotes = optionVotes.filter(v => v.is_available)
          const myVote = optionVotes.find(v => v.voter_id === props.currentUserId)
          const total = props.roster.length
          const myAvailable = myVote?.is_available === true
          const myUnavailable = myVote?.is_available === false

          return (
            <div
              key={key}
              className="relative aspect-square rounded-lg border-2 border-primary-200 bg-primary-50/60 flex flex-col items-center justify-between p-1 overflow-hidden"
            >
              <div className="flex items-center justify-center w-full">
                <span className="text-xs font-semibold text-gray-900">{format(day, 'd')}</span>
                {isToday && <span className="ml-1 h-1 w-1 rounded-full bg-primary-500" />}
              </div>

              {/* Available count badge */}
              <span className="text-[10px] leading-tight font-medium text-green-700">
                {t('availableCount', { count: availableVotes.length, total })}
              </span>

              {/* Vote toggles */}
              <div className="flex gap-0.5 w-full">
                <button
                  type="button"
                  onClick={() => props.onVote(option.id, true)}
                  disabled={props.votingClosed}
                  aria-pressed={myAvailable}
                  aria-label={t('voteAvailableAria', { date: key })}
                  className={`flex-1 rounded text-[10px] leading-none py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    myAvailable
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-green-700 hover:bg-green-100'
                  }`}
                >
                  {t('available')}
                </button>
                <button
                  type="button"
                  onClick={() => props.onVote(option.id, false)}
                  disabled={props.votingClosed}
                  aria-pressed={myUnavailable}
                  aria-label={t('voteUnavailableAria', { date: key })}
                  className={`flex-1 rounded text-[10px] leading-none py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    myUnavailable
                      ? 'bg-red-500 text-white'
                      : 'bg-white text-red-600 hover:bg-red-100'
                  }`}
                >
                  {t('unavailable')}
                </button>
              </div>

              {/* Admin confirm */}
              {props.mode === 'vote' && props.onConfirm && (
                <button
                  type="button"
                  onClick={() => props.onConfirm?.(option.candidate_date)}
                  className="w-full rounded bg-blue-600 text-white text-[9px] leading-none py-1 font-medium hover:bg-blue-700 transition-colors"
                >
                  {t('confirmDate')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Vote-mode legend / closed notice */}
      {props.mode === 'vote' && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-gray-400">{t('voteLegend')}</p>
          {props.votingClosed && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {t('votingClosed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
