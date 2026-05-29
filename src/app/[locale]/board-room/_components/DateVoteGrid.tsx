'use client'

import { useTranslations } from 'next-intl'
import { BOARD_MEETING_TIME } from '@/constants/boardRoom'

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

interface DateVoteGridProps {
  options: DateOption[]
  votes: Vote[]
  roster: RosterMember[]
  currentUserId: string
  votingClosed: boolean
  onVote: (optionId: string, isAvailable: boolean) => Promise<void>
  /** Admin-only: per-row confirm button renderer */
  renderConfirmButton?: (option: DateOption) => React.ReactNode
}

export default function DateVoteGrid({
  options,
  votes,
  roster,
  currentUserId,
  votingClosed,
  onVote,
  renderConfirmButton,
}: DateVoteGridProps) {
  const t = useTranslations('boardRoom.detail')

  if (options.length === 0) {
    return <p className="text-sm text-gray-500 italic">{t('noOptions')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-4 font-medium text-gray-700 min-w-[140px]">
              {t('candidateDate')}
            </th>
            <th className="text-center py-2 px-3 font-medium text-gray-700 min-w-[80px]">
              {t('voteCount')}
            </th>
            <th className="text-center py-2 px-3 font-medium text-gray-700 min-w-[100px]">
              {t('myVote')}
            </th>
            <th className="text-left py-2 px-3 font-medium text-gray-700">{t('whoVoted')}</th>
            {renderConfirmButton && (
              <th className="py-2 px-3 font-medium text-gray-700 min-w-[120px]" />
            )}
          </tr>
        </thead>
        <tbody>
          {options.map(option => {
            const optionVotes = votes.filter(v => v.option_id === option.id)
            const availableVotes = optionVotes.filter(v => v.is_available)
            const myVote = optionVotes.find(v => v.voter_id === currentUserId)
            const total = roster.length

            const availableNames = availableVotes
              .map(v => roster.find(r => r.id === v.voter_id)?.display_name)
              .filter(Boolean)

            const dateLabel = `${option.candidate_date} ${BOARD_MEETING_TIME}`

            return (
              <tr key={option.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 pr-4 text-gray-900 font-medium">{dateLabel}</td>
                <td className="py-3 px-3 text-center">
                  <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                    {t('availableCount', { count: availableVotes.length, total })}
                  </span>
                </td>
                <td className="py-3 px-3 text-center">
                  <div className="flex gap-1.5 justify-center">
                    <button
                      onClick={() => onVote(option.id, true)}
                      disabled={votingClosed}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        myVote?.is_available === true
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      aria-pressed={myVote?.is_available === true}
                    >
                      {t('available')}
                    </button>
                    <button
                      onClick={() => onVote(option.id, false)}
                      disabled={votingClosed}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        myVote?.is_available === false
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      aria-pressed={myVote?.is_available === false}
                    >
                      {t('unavailable')}
                    </button>
                  </div>
                </td>
                <td className="py-3 px-3 text-gray-600 text-xs">
                  {availableNames.length > 0 ? (
                    <span>{availableNames.join(', ')}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                {renderConfirmButton && (
                  <td className="py-3 px-3">{renderConfirmButton(option)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {votingClosed && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {t('votingClosed')}
        </p>
      )}
    </div>
  )
}
