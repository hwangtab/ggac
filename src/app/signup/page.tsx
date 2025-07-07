'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabase/client';

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
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    // 개선된 필드별 유효성 검사
    const fieldLabels = {
      email: '이메일',
      password: '비밀번호',
      displayName: '표시 이름',
      realName: '실명',
      phoneNumber: '전화번호',
      birthDate: '생년월일',
      monthlyFee: '월 조합비',
      bankName: '은행명',
      accountNumber: '계좌번호',
      accountHolder: '예금주'
    };

    // 필수 필드 확인
    for (const [field, label] of Object.entries(fieldLabels)) {
      if (!formData[field as keyof typeof formData] || formData[field as keyof typeof formData].toString().trim() === '') {
        setMessage(`${label}을(를) 입력해주세요.`);
        setLoading(false);
        return;
      }
    }

    // 이메일 형식 검사
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage('올바른 이메일 형식을 입력해주세요.');
      setLoading(false);
      return;
    }

    // 비밀번호 길이 검사
    if (formData.password.length < 6) {
      setMessage('비밀번호는 최소 6자 이상이어야 합니다.');
      setLoading(false);
      return;
    }

    // 전화번호 형식 검사 (한국 휴대폰)
    const phoneRegex = /^01[0-9]-?[0-9]{4}-?[0-9]{4}$/;
    if (!phoneRegex.test(formData.phoneNumber.replace(/[^0-9]/g, ''))) {
      setMessage('올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)');
      setLoading(false);
      return;
    }

    // 생년월일 유효성 검사
    const birthDate = new Date(formData.birthDate);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    if (age < 14 || age > 100) {
      setMessage('올바른 생년월일을 입력해주세요.');
      setLoading(false);
      return;
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
      });

      if (error) {
        // 더 자세한 에러 메시지 제공
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          setMessage('요청이 너무 많습니다. 잠시 후 다시 시도해주세요. (약 5-10분 후)');
        } else if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          setMessage('이미 등록된 이메일입니다. 로그인을 시도하거나 관리자에게 문의해주세요.');
        } else if (error.message.includes('invalid email') || error.message.includes('Invalid email')) {
          setMessage('올바른 이메일 주소를 입력해주세요.');
        } else if (error.message.includes('weak password') || error.message.includes('Password')) {
          setMessage('비밀번호는 최소 6자 이상이어야 합니다.');
        } else if (error.message.includes('signup disabled')) {
          setMessage('현재 조합원 가입이 일시적으로 중단되었습니다. 관리자에게 문의해주세요.');
        } else {
          setMessage(`조합원 가입 오류: ${error.message}`);
        }
        console.error('Signup error details:', error);
      } else if (data.user) {
        // 성공 시 바로 안내 페이지로 리다이렉트
        router.push('/register/submitted');
      }
    } catch (error) {
      setMessage('조합원 가입 중 예상치 못한 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-24 md:pt-28 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 섹션 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-primary-100 mb-6">
            <svg className="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h1 className="heading-secondary text-gray-900 mb-4">
            조합원 가입 신청
          </h1>
          <p className="text-body text-gray-600 max-w-md mx-auto">
            경기아트콜렉티브 협동조합에 오신 것을 환영합니다.<br />
            아래 양식을 작성하여 조합원 가입을 신청해주세요.
          </p>
        </div>

        {/* 메시지 표시 */}
        {message && (
          <div className={`mb-8 p-6 rounded-xl shadow-sm ${
            message.includes('완료') || message.includes('🎉')
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : message.includes('rate limit') || message.includes('너무 많습니다')
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {message.includes('완료') || message.includes('🎉') ? (
                  <svg className="h-5 w-5 text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : message.includes('rate limit') || message.includes('너무 많습니다') ? (
                  <svg className="h-5 w-5 text-amber-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <div className="text-sm whitespace-pre-line leading-relaxed">
                  {message}
                </div>
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
                  <svg className="h-5 w-5 text-primary-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  계정 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">로그인에 사용할 이메일과 비밀번호를 입력해주세요.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-2">
                    이메일 주소 *
                  </label>
                  <input
                    id="email-address"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="example@email.com"
                    onChange={handleChange}
                    value={formData.email}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    비밀번호 *
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="최소 6자 이상"
                    onChange={handleChange}
                    value={formData.password}
                  />
                </div>
              </div>
            </div>

            {/* 개인 정보 섹션 */}
            <div className="space-y-6">
              <div className="pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg className="h-5 w-5 text-primary-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  개인 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">조합원 등록을 위한 기본 정보를 입력해주세요.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                    표시 이름 *
                  </label>
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="게시판에서 사용할 이름"
                    onChange={handleChange}
                    value={formData.displayName}
                  />
                </div>
                <div>
                  <label htmlFor="realName" className="block text-sm font-medium text-gray-700 mb-2">
                    실명 *
                  </label>
                  <input
                    id="realName"
                    name="realName"
                    type="text"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="본명"
                    onChange={handleChange}
                    value={formData.realName}
                  />
                </div>
                <div>
                  <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
                    전화번호 *
                  </label>
                  <input
                    id="phoneNumber"
                    name="phoneNumber"
                    type="tel"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="010-0000-0000"
                    onChange={handleChange}
                    value={formData.phoneNumber}
                  />
                </div>
                <div>
                  <label htmlFor="birthDate" className="block text-sm font-medium text-gray-700 mb-2">
                    생년월일 *
                  </label>
                  <input
                    id="birthDate"
                    name="birthDate"
                    type="date"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    onChange={handleChange}
                    value={formData.birthDate}
                  />
                </div>
              </div>
            </div>

            {/* 조합비 및 계좌 정보 섹션 */}
            <div className="space-y-6">
              <div className="pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg className="h-5 w-5 text-primary-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  조합비 및 계좌 정보
                </h3>
                <p className="text-sm text-gray-600 mt-1">월 조합비와 관련 계좌 정보를 입력해주세요.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label htmlFor="monthlyFee" className="block text-sm font-medium text-gray-700 mb-2">
                    월 조합비 *
                  </label>
                  <select
                    id="monthlyFee"
                    name="monthlyFee"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
                    onChange={handleChange}
                    value={formData.monthlyFee}
                  >
                    <option value="10000">월 10,000원</option>
                    <option value="20000">월 20,000원</option>
                    <option value="30000">월 30,000원</option>
                    <option value="40000">월 40,000원</option>
                    <option value="50000">월 50,000원</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="bankName" className="block text-sm font-medium text-gray-700 mb-2">
                    은행명 *
                  </label>
                  <input
                    id="bankName"
                    name="bankName"
                    type="text"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="예: 국민은행"
                    onChange={handleChange}
                    value={formData.bankName}
                  />
                </div>
                <div>
                  <label htmlFor="accountNumber" className="block text-sm font-medium text-gray-700 mb-2">
                    계좌번호 *
                  </label>
                  <input
                    id="accountNumber"
                    name="accountNumber"
                    type="text"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="계좌번호를 입력하세요"
                    onChange={handleChange}
                    value={formData.accountNumber}
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="accountHolder" className="block text-sm font-medium text-gray-700 mb-2">
                    예금주 *
                  </label>
                  <input
                    id="accountHolder"
                    name="accountHolder"
                    type="text"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="계좌 명의자"
                    onChange={handleChange}
                    value={formData.accountHolder}
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
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
            <Link href="/login" className="font-medium text-primary-600 hover:text-primary-500 transition-colors">
              로그인하기
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}