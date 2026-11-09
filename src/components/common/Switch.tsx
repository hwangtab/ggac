'use client'

import { FiCheck } from 'react-icons/fi'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  /** 접근 가능한 이름 (aria-label). 보이는 라벨이 있으면 aria-labelledby 를 쓴다. */
  label?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  disabled?: boolean
  className?: string
}

/**
 * 접근 가능한 토글 스위치. role="switch" + aria-checked, Space/Enter 는 button 기본 동작.
 * 색 외에도 켜짐 상태에서 체크 아이콘이 표시된다.
 */
export default function Switch({
  checked,
  onCheckedChange,
  label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  disabled = false,
  className = '',
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`${
        checked ? 'bg-primary-600' : 'bg-gray-200'
      } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${className}`}
    >
      <span
        className={`${
          checked ? 'translate-x-5' : 'translate-x-0'
        } pointer-events-none inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      >
        {checked && <FiCheck className="h-3 w-3 text-primary-600" aria-hidden="true" />}
      </span>
    </button>
  )
}
