'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface CandidateDatePickerProps {
  dates: string[]
  onChange: (dates: string[]) => void
}

export default function CandidateDatePicker({ dates, onChange }: CandidateDatePickerProps) {
  const t = useTranslations('boardRoom.newMeeting')
  const [inputDate, setInputDate] = useState('')

  const addDate = () => {
    const trimmed = inputDate.trim()
    if (!trimmed) return
    if (dates.includes(trimmed)) {
      setInputDate('')
      return
    }
    onChange([...dates, trimmed].sort())
    setInputDate('')
  }

  const removeDate = (date: string) => {
    onChange(dates.filter(d => d !== date))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addDate()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="date"
          value={inputDate}
          onChange={e => setInputDate(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
        <button
          type="button"
          onClick={addDate}
          disabled={!inputDate}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t('addDate')}
        </button>
      </div>

      <p className="text-xs text-gray-500">{t('candidateDateHint')}</p>

      {dates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dates.map(date => (
            <span
              key={date}
              className="inline-flex items-center gap-1 px-3 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-full text-sm"
            >
              {date} 21:00
              <button
                type="button"
                onClick={() => removeDate(date)}
                className="ml-1 text-primary-400 hover:text-primary-700 transition-colors"
                aria-label={`${date} 제거`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
