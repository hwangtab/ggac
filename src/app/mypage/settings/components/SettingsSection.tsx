'use client'

import { ReactNode } from 'react'

interface SettingsSectionProps {
  title: string
  description?: string
  children: ReactNode
}

export default function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="pb-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}
      </div>

      {/* 설정 내용 */}
      <div className="space-y-6">{children}</div>
    </div>
  )
}
