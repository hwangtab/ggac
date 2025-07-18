'use client'

import { useState } from 'react'
import { MemberProfile } from '@/types'
import PersonalInfo from './PersonalInfo'
import CooperativeInfo from './CooperativeInfo'
import AccountInfo from './AccountInfo'

interface ProfileEditFormProps {
  profile: MemberProfile
  onUpdate: (updates: Partial<MemberProfile>) => Promise<void>
  loading: boolean
}

const ProfileEditForm: React.FC<ProfileEditFormProps> = ({ 
  profile, 
  onUpdate,
  loading
}) => {
  const [formData, setFormData] = useState({
    display_name: profile.display_name || '',
    phone_number: profile.phone_number || '',
    birth_date: profile.birth_date || '',
    monthly_fee: profile.monthly_fee || 0,
    bank_name: profile.bank_name || '',
    account_number: profile.account_number || '',
    account_holder: profile.account_holder || ''
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isDirty, setIsDirty] = useState(false)

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
    
    // 에러 클리어
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.display_name.trim()) {
      newErrors.display_name = '표시 이름은 필수입니다.'
    }

    if (!formData.phone_number.trim()) {
      newErrors.phone_number = '전화번호는 필수입니다.'
    } else if (!/^[\d\-\+\(\)\s]+$/.test(formData.phone_number)) {
      newErrors.phone_number = '올바른 전화번호 형식이 아닙니다.'
    }

    if (formData.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(formData.birth_date)) {
      newErrors.birth_date = '올바른 날짜 형식이 아닙니다. (YYYY-MM-DD)'
    }

    if (formData.monthly_fee < 0) {
      newErrors.monthly_fee = '조합비는 0원 이상이어야 합니다.'
    }

    if (formData.account_number && !formData.bank_name) {
      newErrors.bank_name = '계좌번호가 있으면 은행명도 입력해주세요.'
    }

    if (formData.bank_name && !formData.account_number) {
      newErrors.account_number = '은행명이 있으면 계좌번호도 입력해주세요.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onUpdate(formData)
      setIsDirty(false)
    } catch (error) {
      console.error('Form submission error:', error)
    }
  }

  const handleReset = () => {
    setFormData({
      display_name: profile.display_name || '',
      phone_number: profile.phone_number || '',
      birth_date: profile.birth_date || '',
      monthly_fee: profile.monthly_fee || 0,
      bank_name: profile.bank_name || '',
      account_number: profile.account_number || '',
      account_holder: profile.account_holder || ''
    })
    setErrors({})
    setIsDirty(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 개인 정보 */}
      <PersonalInfo 
        data={formData}
        errors={errors}
        onChange={handleChange}
        readOnlyEmail={profile.email}
      />

      {/* 조합 정보 */}
      <CooperativeInfo 
        data={formData}
        errors={errors}
        onChange={handleChange}
      />

      {/* 계좌 정보 */}
      <AccountInfo 
        data={formData}
        errors={errors}
        onChange={handleChange}
      />

      {/* 버튼 */}
      <div className="flex justify-between items-center pt-6 border-t border-gray-200">
        <div className="text-sm text-gray-500">
          {isDirty && '* 변경된 내용이 있습니다.'}
        </div>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || loading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            취소
          </button>
          
          <button 
            type="submit" 
            disabled={!isDirty || loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                저장 중...
              </div>
            ) : (
              '저장'
            )}
          </button>
        </div>
      </div>
    </form>
  )
}

export default ProfileEditForm