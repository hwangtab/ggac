'use client'

import { REGIONS, STANDARD_GENRES } from '@/constants/interests'

interface InterestSettingsProps {
  genres: string[]
  regions: string[]
  onChange: (next: { genres: string[]; regions: string[] }) => void
  disabled?: boolean
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

export default function InterestSettings({
  genres,
  regions,
  onChange,
  disabled,
}: InterestSettingsProps) {
  const unset = genres.length === 0 && regions.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">관심 분야</h3>
        <p className="mt-1 text-xs text-gray-500">
          지원사업 안내와 캘린더에 반영됩니다. 고르지 않으면 조합 기본값(경기·서울 × 음악)으로
          받습니다.
        </p>
      </div>

      {unset && (
        <p className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-800">
          지금은 조합 기본값으로 받고 있습니다. 아래에서 고르면 그 설정이 대신 적용됩니다.
        </p>
      )}

      <fieldset disabled={disabled}>
        <legend className="mb-2 text-xs font-medium text-gray-700">장르</legend>
        <div className="flex flex-wrap gap-2">
          {STANDARD_GENRES.map(g => (
            <label
              key={g}
              className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                genres.includes(g)
                  ? 'border-blue-600 bg-blue-50 text-blue-800'
                  : 'border-gray-300 text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={genres.includes(g)}
                onChange={() => onChange({ genres: toggle(genres, g), regions })}
              />
              {g}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="mb-2 text-xs font-medium text-gray-700">지역</legend>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map(r => (
            <label
              key={r}
              className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                regions.includes(r)
                  ? 'border-blue-600 bg-blue-50 text-blue-800'
                  : 'border-gray-300 text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={regions.includes(r)}
                onChange={() => onChange({ genres, regions: toggle(regions, r) })}
              />
              {r}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          전국 대상 공고는 지역 설정과 무관하게 항상 보입니다.
        </p>
      </fieldset>
    </div>
  )
}
