'use client'

import { FiUser } from 'react-icons/fi'

interface PersonalInfoProps {
  data: {
    display_name: string
    phone_number: string
    birth_date: string
  }
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
  readOnlyEmail: string
}

const PersonalInfo: React.FC<PersonalInfoProps> = ({
  data,
  errors,
  onChange,
  readOnlyEmail
}) => {
  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center mb-6">
        <FiUser className="w-5 h-5 text-primary-600 mr-3" />
        <h2 className="text-lg font-semibold text-gray-900">개인 정보</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 이메일 (읽기 전용) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            이메일
          </label>
          <input
            type="email"
            value={readOnlyEmail}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-gray-500">
            이메일은 변경할 수 없습니다.
          </p>
        </div>

        {/* 표시 이름 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            표시 이름 *
          </label>
          <input
            type="text"
            value={data.display_name}
            onChange={(e) => onChange('display_name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.display_name 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="홍길동"
          />
          {errors.display_name && (
            <p className="mt-1 text-xs text-red-600">{errors.display_name}</p>
          )}
        </div>

        {/* 전화번호 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            전화번호 *
          </label>
          <input
            type="tel"
            value={data.phone_number}
            onChange={(e) => onChange('phone_number', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.phone_number 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="010-1234-5678"
          />
          {errors.phone_number && (
            <p className="mt-1 text-xs text-red-600">{errors.phone_number}</p>
          )}
        </div>

        {/* 생년월일 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            생년월일
          </label>
          <input
            type="date"
            value={data.birth_date}
            onChange={(e) => onChange('birth_date', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.birth_date 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
          />
          {errors.birth_date && (
            <p className="mt-1 text-xs text-red-600">{errors.birth_date}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            선택사항입니다.
          </p>
        </div>
      </div>
    </div>
  )
}

export default PersonalInfo