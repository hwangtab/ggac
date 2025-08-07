'use client';

import Link from 'next/link';

export default function RejectedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-24 md:pt-28 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg mx-auto">
        {/* 헤더 섹션 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-red-100 mb-6">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="heading-secondary mb-4">
            가입 신청 거절
          </h1>
          <p className="text-body text-gray-600">
            조합원 가입 신청이 거절되었습니다.
          </p>
        </div>
        
        {/* 안내 메시지 */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden mb-8">
          <div className="p-8">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">거절 사유</h3>
                <div className="text-gray-700 space-y-2">
                  <p>제출하신 정보가 조합원 가입 기준에 부합하지 않거나, 추가 정보가 필요할 수 있습니다.</p>
                  <p className="text-sm text-gray-600">가능한 사유:</p>
                  <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 ml-4">
                    <li>필수 정보 미기재 또는 불완전한 정보</li>
                    <li>조합 가입 자격 요건 미충족</li>
                    <li>중복 신청 또는 기존 회원과의 중복</li>
                    <li>기타 운영 정책에 따른 제한</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 다음 단계 안내 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">다음 단계</h4>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• 자세한 거절 사유가 궁금하시면 문의하기를 이용해주세요</p>
                <p>• 조건을 충족한 후 재신청이 가능합니다</p>
                <p>• 경기아트콜렉티브의 공개 활동은 계속 참여하실 수 있습니다</p>
              </div>
            </div>
          </div>
        </div>

        {/* 액션 버튼들 */}
        <div className="space-y-4">
          <Link 
            href="/connect"
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 text-center block"
          >
            문의하기
          </Link>
          
          <div className="text-center">
            <Link href="/" className="font-medium text-gray-600 hover:text-gray-800 transition-colors">
              홈으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
