'use client'

// 정적 생성 방지 - 인증이 필요한 동적 페이지
export const dynamic = 'force-dynamic'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase/client'
import FormField from '../../components/FormField'
import { useStablePageLoad } from '../../utils/routeProtection'

export default function SignupPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    realName: '',
    phoneNumber: '',
    birthDate: '',
    monthlyFee: '10000',
    bankName: '',
    accountNumber: '',
    accountHolder: '',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [fieldStates, setFieldStates] = useState<Record<string, 'default' | 'error' | 'success'>>(
    {}
  )
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const router = useRouter()
  const { isLoading: pageLoading, isReady } = useStablePageLoad('/signup')

  // 각 입력창에 대한 ref
  const fieldRefs = {
    email: useRef<HTMLInputElement | null>(null),
    password: useRef<HTMLInputElement | null>(null),
    displayName: useRef<HTMLInputElement | null>(null),
    realName: useRef<HTMLInputElement | null>(null),
    phoneNumber: useRef<HTMLInputElement | null>(null),
    birthDate: useRef<HTMLInputElement | null>(null),
    bankName: useRef<HTMLInputElement | null>(null),
    accountNumber: useRef<HTMLInputElement | null>(null),
    accountHolder: useRef<HTMLInputElement | null>(null),
  }

  // 실시간 유효성 검사 함수
  const validateField = (name: string, value: string) => {
    let error = ''
    let state: 'default' | 'error' | 'success' = 'default'

    switch (name) {
      case 'email':
        if (value.trim() === '') {
          error = ''
          state = 'default'
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          error = '올바른 이메일 형식을 입력해주세요. (예: example@email.com)'
          state = 'error'
        } else {
          state = 'success'
        }
        break

      case 'password':
        if (value.trim() === '') {
          error = ''
          state = 'default'
        } else if (value.length < 6) {
          error = '비밀번호는 최소 6자 이상이어야 합니다.'
          state = 'error'
        } else {
          state = 'success'
        }
        break

      case 'phoneNumber':
        if (value.trim() === '') {
          error = ''
          state = 'default'
        } else if (!/^01[0-9]-?[0-9]{4}-?[0-9]{4}$/.test(value.replace(/[^0-9]/g, ''))) {
          error = '올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)'
          state = 'error'
        } else {
          state = 'success'
        }
        break

      case 'birthDate':
        if (value.trim() === '') {
          error = ''
          state = 'default'
        } else {
          const birthDate = new Date(value)
          const today = new Date()
          const age = today.getFullYear() - birthDate.getFullYear()
          if (age < 14 || age > 100) {
            error = '14세 이상 100세 이하만 가입 가능합니다.'
            state = 'error'
          } else {
            state = 'success'
          }
        }
        break

      case 'displayName':
      case 'realName':
      case 'bankName':
      case 'accountNumber':
      case 'accountHolder':
        if (value.trim() === '') {
          error = ''
          state = 'default'
        } else if (value.trim().length < 2) {
          error = '최소 2자 이상 입력해주세요.'
          state = 'error'
        } else {
          state = 'success'
        }
        break
    }

    return { error, state }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target

    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))

    // 실시간 유효성 검사
    const { error, state } = validateField(name, value)

    setFieldErrors(prev => ({
      ...prev,
      [name]: error,
    }))

    setFieldStates(prev => ({
      ...prev,
      [name]: state,
    }))
  }

  // 에러가 있는 첫 번째 필드로 스크롤하는 함수
  const scrollToFirstError = (errors: Record<string, string>) => {
    const fieldOrder = [
      'email',
      'password',
      'displayName',
      'realName',
      'phoneNumber',
      'birthDate',
      'bankName',
      'accountNumber',
      'accountHolder',
    ]

    for (const field of fieldOrder) {
      if (errors[field]) {
        const fieldRef = fieldRefs[field as keyof typeof fieldRefs]
        if (fieldRef.current) {
          fieldRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest',
          })

          // 포커스 및 흔들림 애니메이션
          setTimeout(() => {
            fieldRef.current?.focus()
            fieldRef.current?.classList.add('animate-shake')
            setTimeout(() => {
              fieldRef.current?.classList.remove('animate-shake')
            }, 600)
          }, 500)

          break
        }
      }
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    // 전체 필드 유효성 검사
    const validationErrors: Record<string, string> = {}
    const fieldOrder = [
      'email',
      'password',
      'displayName',
      'realName',
      'phoneNumber',
      'birthDate',
      'bankName',
      'accountNumber',
      'accountHolder',
    ]

    for (const field of fieldOrder) {
      const value = formData[field as keyof typeof formData]?.toString() || ''
      const { error } = validateField(field, value)

      if (value.trim() === '') {
        const fieldLabels: Record<string, string> = {
          email: '이메일',
          password: '비밀번호',
          displayName: '표시 이름',
          realName: '실명',
          phoneNumber: '전화번호',
          birthDate: '생년월일',
          bankName: '은행명',
          accountNumber: '계좌번호',
          accountHolder: '예금주',
        }
        validationErrors[field] = `${fieldLabels[field]}을(를) 입력해주세요.`
      } else if (error) {
        validationErrors[field] = error
      }
    }

    // 에러가 있으면 첫 번째 에러 필드로 스크롤하고 중단
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)

      // 에러 상태 업데이트
      const newFieldStates: Record<string, 'default' | 'error' | 'success'> = {}
      Object.keys(validationErrors).forEach(field => {
        newFieldStates[field] = 'error'
      })
      setFieldStates(prev => ({ ...prev, ...newFieldStates }))

      // 첫 번째 에러 필드로 스크롤
      scrollToFirstError(validationErrors)
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            display_name: formData.displayName,
            real_name: formData.realName,
            phone_number: formData.phoneNumber,
            birth_date: formData.birthDate,
            monthly_fee: parseInt(formData.monthlyFee),
            bank_name: formData.bankName,
            account_number: formData.accountNumber,
            account_holder: formData.accountHolder,
          },
        },
      })

      if (error) {
        // 더 자세한 에러 메시지 제공
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          setMessage('요청이 너무 많습니다. 잠시 후 다시 시도해주세요. (약 5-10분 후)')
        } else if (
          error.message.includes('already registered') ||
          error.message.includes('User already registered')
        ) {
          setMessage('이미 등록된 이메일입니다. 로그인을 시도하거나 관리자에게 문의해주세요.')
        } else if (
          error.message.includes('invalid email') ||
          error.message.includes('Invalid email')
        ) {
          setMessage('올바른 이메일 주소를 입력해주세요.')
        } else if (error.message.includes('weak password') || error.message.includes('Password')) {
          setMessage('비밀번호는 최소 6자 이상이어야 합니다.')
        } else if (error.message.includes('signup disabled')) {
          setMessage('현재 조합원 가입이 일시적으로 중단되었습니다. 관리자에게 문의해주세요.')
        } else {
          setMessage(`조합원 가입 오류: ${error.message}`)
        }
        console.error('Signup error details:', error)
      } else if (data.user) {
        // 성공 시 바로 안내 페이지로 리다이렉트
        setMessage('가입 신청이 완료되었습니다! 안내 페이지로 이동합니다...')
        // 미들웨어 처리 시간 확보
        await new Promise(resolve => setTimeout(resolve, 200))
        router.push('/register/pending')
      }
    } catch (error) {
      setMessage('조합원 가입 중 예상치 못한 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 페이지 안정화 중이면 로딩 표시
  if (pageLoading || !isReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">페이지를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 섹션 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-primary-100 mb-6">
            <svg
              className="h-8 w-8 text-primary-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              />
            </svg>
          </div>
          <h1 className="tw-heading-secondary text-gray-900 mb-4">조합원 가입 신청</h1>
          <p className="tw-text-body text-gray-600 max-w-md mx-auto">
            경기아트콜렉티브 협동조합에 오신 것을 환영합니다.
            <br />
            아래 양식을 작성하여 조합원 가입을 신청해주세요.
          </p>
        </div>

        {/* 메시지 표시 */}
        {message && (
          <div
            className={`mb-8 p-6 rounded-xl shadow-sm ${
              message.includes('완료') || message.includes('🎉')
                ? 'bg-green-50 text-green-800 border border-green-200'
                : message.includes('rate limit') || message.includes('너무 많습니다')
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {message.includes('완료') || message.includes('🎉') ? (
                  <svg
                    className="h-5 w-5 text-green-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : message.includes('rate limit') || message.includes('너무 많습니다') ? (
                  <svg
                    className="h-5 w-5 text-amber-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-5 w-5 text-red-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <div className="text-sm whitespace-pre-line leading-relaxed">{message}</div>
              </div>
            </div>
          </div>
        )}

        {/* 폼 섹션 */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
          <form onSubmit={handleSignup} className="p-8 space-y-8">
            {/* 계정 정보 섹션 */}
            <div className="space-y-6">
              <div className="pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg
                    className="h-5 w-5 text-primary-600 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  계정 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  로그인에 사용할 이메일과 비밀번호를 입력해주세요.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  label="이메일 주소"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="example@email.com"
                  required={true}
                  error={fieldErrors.email}
                  state={fieldStates.email}
                  disabled={loading}
                  fieldRef={fieldRefs.email}
                />
                <FormField
                  label="비밀번호"
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="최소 6자 이상"
                  required={true}
                  error={fieldErrors.password}
                  state={fieldStates.password}
                  disabled={loading}
                  fieldRef={fieldRefs.password}
                />
              </div>
            </div>

            {/* 개인 정보 섹션 */}
            <div className="space-y-6">
              <div className="pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg
                    className="h-5 w-5 text-primary-600 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  개인 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  조합원 등록을 위한 기본 정보를 입력해주세요.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  label="표시 이름"
                  name="displayName"
                  value={formData.displayName}
                  onChange={handleChange}
                  placeholder="게시판에서 사용할 이름"
                  required={true}
                  error={fieldErrors.displayName}
                  state={fieldStates.displayName}
                  disabled={loading}
                  fieldRef={fieldRefs.displayName}
                />
                <FormField
                  label="실명"
                  name="realName"
                  value={formData.realName}
                  onChange={handleChange}
                  placeholder="본명"
                  required={true}
                  error={fieldErrors.realName}
                  state={fieldStates.realName}
                  disabled={loading}
                  fieldRef={fieldRefs.realName}
                />
                <FormField
                  label="전화번호"
                  name="phoneNumber"
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                  placeholder="010-0000-0000"
                  required={true}
                  error={fieldErrors.phoneNumber}
                  state={fieldStates.phoneNumber}
                  disabled={loading}
                  fieldRef={fieldRefs.phoneNumber}
                />
                <FormField
                  label="생년월일"
                  name="birthDate"
                  type="date"
                  value={formData.birthDate}
                  onChange={handleChange}
                  required={true}
                  error={fieldErrors.birthDate}
                  state={fieldStates.birthDate}
                  disabled={loading}
                  fieldRef={fieldRefs.birthDate}
                />
              </div>
            </div>

            {/* 조합비 및 계좌 정보 섹션 */}
            <div className="space-y-6">
              <div className="pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg
                    className="h-5 w-5 text-primary-600 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  조합비 및 계좌 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  월 조합비와 관련 계좌 정보를 입력해주세요.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label
                    htmlFor="monthlyFee"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    월 조합비 <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="monthlyFee"
                    name="monthlyFee"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white disabled:bg-gray-50 disabled:text-gray-500"
                    onChange={handleChange}
                    value={formData.monthlyFee}
                    disabled={loading}
                  >
                    <option value="10000">월 10,000원</option>
                    <option value="20000">월 20,000원</option>
                    <option value="30000">월 30,000원</option>
                    <option value="40000">월 40,000원</option>
                    <option value="50000">월 50,000원</option>
                  </select>
                </div>
                <FormField
                  label="은행명"
                  name="bankName"
                  value={formData.bankName}
                  onChange={handleChange}
                  placeholder="예: 국민은행"
                  required={true}
                  error={fieldErrors.bankName}
                  state={fieldStates.bankName}
                  disabled={loading}
                  fieldRef={fieldRefs.bankName}
                />
                <FormField
                  label="계좌번호"
                  name="accountNumber"
                  value={formData.accountNumber}
                  onChange={handleChange}
                  placeholder="계좌번호를 입력하세요"
                  required={true}
                  error={fieldErrors.accountNumber}
                  state={fieldStates.accountNumber}
                  disabled={loading}
                  fieldRef={fieldRefs.accountNumber}
                />
                <div className="md:col-span-2">
                  <FormField
                    label="예금주"
                    name="accountHolder"
                    value={formData.accountHolder}
                    onChange={handleChange}
                    placeholder="계좌 명의자"
                    required={true}
                    error={fieldErrors.accountHolder}
                    state={fieldStates.accountHolder}
                    disabled={loading}
                    fieldRef={fieldRefs.accountHolder}
                  />
                </div>
              </div>
            </div>

            {/* 제출 버튼 */}
            <div className="pt-6 border-t border-gray-200">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    가입 처리 중...
                  </span>
                ) : (
                  '조합원 가입 신청하기'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* 하단 링크 */}
        <div className="text-center mt-8">
          <p className="text-gray-600">
            이미 계정이 있으신가요?{' '}
            <Link
              href="/login"
              className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
            >
              로그인하기
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
