'use client'

import { FiCreditCard } from 'react-icons/fi'

interface AccountInfoProps {
  data: {
    bank_name: string
    account_number: string
    account_holder: string
  }
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
}

const AccountInfo: React.FC<AccountInfoProps> = ({
  data,
  errors,
  onChange
}) => {
  const bankOptions = [
    '', // 선택 안함
    '국민은행',
    '신한은행',
    '우리은행',
    '하나은행',
    'KB국민은행',
    'NH농협은행',
    '기업은행',
    '수협은행',
    '대구은행',
    '부산은행',
    '경남은행',
    '광주은행',
    '전북은행',
    '제주은행',
    '씨티은행',
    'SC제일은행',
    '카카오뱅크',
    '케이뱅크',
    '토스뱅크',
    '기타'
  ]

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center mb-6">
        <FiCreditCard className="w-5 h-5 text-primary-600 mr-3" />
        <h2 className="text-lg font-semibold text-gray-900">계좌 정보</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 은행명 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            은행명
          </label>
          <select
            value={data.bank_name}
            onChange={(e) => onChange('bank_name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.bank_name 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
          >
            <option value="">은행을 선택하세요</option>
            {bankOptions.slice(1).map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
          </select>
          {errors.bank_name && (
            <p className="mt-1 text-xs text-red-600">{errors.bank_name}</p>
          )}
        </div>

        {/* 계좌번호 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            계좌번호
          </label>
          <input
            type="text"
            value={data.account_number}
            onChange={(e) => onChange('account_number', e.target.value.replace(/[^0-9-]/g, ''))}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.account_number 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="123-456-789012"
          />
          {errors.account_number && (
            <p className="mt-1 text-xs text-red-600">{errors.account_number}</p>
          )}
        </div>

        {/* 예금주 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            예금주
          </label>
          <input
            type="text"
            value={data.account_holder}
            onChange={(e) => onChange('account_holder', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.account_holder 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="홍길동"
          />
          {errors.account_holder && (
            <p className="mt-1 text-xs text-red-600">{errors.account_holder}</p>
          )}
        </div>

        {/* 안내 메시지 */}
        <div className="md:col-span-1">
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-2">💡 계좌 정보 안내</p>
              <ul className="space-y-1 text-xs">
                <li>• 조합비 자동이체를 위한 정보입니다.</li>
                <li>• 선택사항이며, 나중에 입력하셔도 됩니다.</li>
                <li>• 입력된 정보는 안전하게 보호됩니다.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccountInfo