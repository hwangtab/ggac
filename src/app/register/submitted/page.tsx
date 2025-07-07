'use client';

import { useRouter } from 'next/navigation';

export default function SubmittedPage() {
  const router = useRouter();

  const handleLoginNow = () => {
    router.push('/login');
  };

  const handleContactAdmin = () => {
    // 관리자 연락처로 이동 (이메일 또는 연락 페이지)
    window.location.href = 'mailto:contact@ggac.kr?subject=조합원 가입 문의';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-accent-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-8 md:p-12">
            {/* 성공 아이콘 */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                가입 신청이 완료되었습니다!
              </h1>
              <p className="text-lg text-gray-600">
                경기아트콜렉티브 협동조합에 관심을 가져주셔서 감사합니다.
              </p>
            </div>

            {/* 다음 단계 안내 */}
            <div className="space-y-6 mb-8">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-blue-900 mb-4 flex items-center">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">1</span>
                  이메일 인증
                </h2>
                <div className="text-blue-800 space-y-2">
                  <p>• 가입 시 입력하신 이메일로 인증 메일이 발송되었습니다</p>
                  <p>• 받은편지함을 확인하시고, 없다면 <strong>스팸함</strong>도 확인해 주세요</p>
                  <p>• 이메일의 "이메일 인증" 버튼을 클릭해주세요</p>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-yellow-900 mb-4 flex items-center">
                  <span className="w-6 h-6 bg-yellow-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">2</span>
                  관리자 승인 대기
                </h2>
                <div className="text-yellow-800 space-y-2">
                  <p>• 이메일 인증 완료 후, 관리자가 가입 신청을 검토합니다</p>
                  <p>• 승인까지 <strong>0-3일</strong> 정도 소요될 수 있습니다</p>
                  <p>• 승인 결과는 별도로 안내드리겠습니다</p>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-green-900 mb-4 flex items-center">
                  <span className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">3</span>
                  조합원 활동 시작
                </h2>
                <div className="text-green-800 space-y-2">
                  <p>• 승인 완료 후 조합원 게시판에 접근할 수 있습니다</p>
                  <p>• 다양한 협동조합 활동에 참여해주세요</p>
                  <p>• 창작 활동과 네트워킹의 기회를 만들어가세요</p>
                </div>
              </div>
            </div>

            {/* 문의 안내 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">문의사항이 있으신가요?</h3>
              <p className="text-gray-700 mb-4">
                가입 과정에서 문제가 발생하거나 궁금한 점이 있으시면 언제든 연락주세요.
              </p>
              <button
                onClick={handleContactAdmin}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                관리자에게 문의하기
              </button>
            </div>

            {/* 액션 버튼들 */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleLoginNow}
                className="bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
              >
                지금 로그인하기
              </button>
              <button
                onClick={() => router.push('/')}
                className="bg-gray-200 text-gray-800 px-8 py-3 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                홈페이지로 가기
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}