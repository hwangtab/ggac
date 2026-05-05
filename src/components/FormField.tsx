'use client'

import React from 'react'

interface FormFieldProps {
  label: string
  name: string
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  required?: boolean
  error?: string
  state?: 'default' | 'error' | 'success'
  disabled?: boolean
  fieldRef?: React.RefObject<HTMLInputElement | null>
  helpText?: string
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  error,
  state = 'default',
  disabled = false,
  fieldRef,
  helpText,
}) => {
  const getInputClasses = () => {
    const baseClasses =
      'w-full box-border px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all duration-200 disabled:bg-gray-50 disabled:text-gray-500'

    switch (state) {
      case 'error':
        return `${baseClasses} border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-50`
      case 'success':
        return `${baseClasses} border-green-500 focus:ring-green-500 focus:border-green-500 bg-green-50`
      default:
        return `${baseClasses} border-gray-300 focus:ring-primary-500 focus:border-primary-500`
    }
  }

  const getIconClasses = () => {
    switch (state) {
      case 'error':
        return 'text-red-500'
      case 'success':
        return 'text-green-500'
      default:
        return 'text-gray-400'
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      <div className="relative">
        <input
          ref={fieldRef}
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={getInputClasses()}
          autoComplete={type === 'email' ? 'email' : type === 'password' ? 'new-password' : 'off'}
        />

        {/* 상태 아이콘 */}
        {state !== 'default' && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            {state === 'error' ? (
              <svg
                className={`h-5 w-5 ${getIconClasses()}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : state === 'success' ? (
              <svg
                className={`h-5 w-5 ${getIconClasses()}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            ) : null}
          </div>
        )}
      </div>

      {/* 도움말 텍스트 */}
      {helpText && (
        <p className="text-xs text-gray-500">{helpText}</p>
      )}

      {/* 에러 메시지 */}
      {error && (
        <div className="flex items-start space-x-2 animate-in slide-in-from-top-1 duration-200">
          <svg
            className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-red-600 leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  )
}

export default FormField
