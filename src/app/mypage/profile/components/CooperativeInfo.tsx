'use client'

import { FiUsers } from 'react-icons/fi'

interface CooperativeInfoProps {
  data: {
    monthly_fee: number
  }
  errors: Record<string, string>
  onChange: (field: string, value: number) => void
}

const CooperativeInfo: React.FC<CooperativeInfoProps> = ({
  data,
  errors,
  onChange
}) => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ko-KR').format(value)
  }

  const handleFeeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) || 0
    onChange('monthly_fee', value)
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center mb-6">
        <FiUsers className="w-5 h-5 text-primary-600 mr-3" />
        <h2 className="text-lg font-semibold text-gray-900">조합 정보</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 월 조합비 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            월 조합비 (원)
          </label>
          <div className="relative">
            <input
              type="number"
              value={data.monthly_fee}
              onChange={handleFeeChange}
              min="0"
              step="1000"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
                errors.monthly_fee 
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                  : 'border-gray-300'
              }`}
              placeholder="0"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 text-sm">원</span>
            </div>
          </div>
          {errors.monthly_fee && (
            <p className="mt-1 text-xs text-red-600">{errors.monthly_fee}</p>
          )}
          {data.monthly_fee > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              월 {formatCurrency(data.monthly_fee)}원
            </p>
          )}
        </div>

        {/* 조합원 상태 (읽기 전용 정보) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            조합원 정보
          </label>
          <div className="bg-white border border-gray-300 rounded-md p-3">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">가입일:</span>
                <span className="text-gray-900">가입 승인 후 확인 가능</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">출자금:</span>
                <span className="text-gray-900">100,000원</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">납입 방식:</span>
                <span className="text-gray-900">월별 자동이체</span>
              </div>
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            조합원 정보는 관리자가 관리합니다.
          </p>
        </div>
      </div>
    </div>
  )
}

export default CooperativeInfo