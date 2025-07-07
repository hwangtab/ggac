export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-20 pt-32">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">개인정보처리방침</h1>
        
        <div className="max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">1. 개인정보의 수집 및 이용목적</h2>
            <p className="text-gray-700 mb-4">
              경기아트콜렉티브 협동조합(이하 "조합")은 다음의 목적을 위하여 개인정보를 처리합니다.
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>조합원 가입의사 확인, 조합원 자격 유지·관리</li>
              <li>서비스 제공에 관한 계약 이행 및 서비스 제공에 따른 요금정산</li>
              <li>고충처리를 위한 의사소통 경로의 확보</li>
              <li>새로운 서비스·상품이나 새로운 기능의 개발 및 제공</li>
              <li>전시, 행사, 교육 프로그램 안내 및 참여 관리</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">2. 수집하는 개인정보의 항목</h2>
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-800 mb-2">필수항목</h3>
              <ul className="list-disc list-inside text-gray-700 space-y-1">
                <li>이메일 주소</li>
                <li>비밀번호(소셜 로그인 제외)</li>
                <li>표시 이름</li>
              </ul>
            </div>
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-800 mb-2">소셜 로그인 시 추가 수집 항목</h3>
              <ul className="list-disc list-inside text-gray-700 space-y-1">
                <li>소셜 계정 식별자</li>
                <li>프로필 이미지</li>
                <li>소셜 계정에서 제공하는 공개 프로필 정보</li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">3. 개인정보의 처리 및 보유 기간</h2>
            <p className="text-gray-700 mb-4">
              조합은 법령에 따른 개인정보 보유·이용기간 또는 정보주체로부터 개인정보를 수집 시에 
              동의받은 개인정보 보유·이용기간 내에서 개인정보를 처리·보유합니다.
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>조합원 관리: 조합원 탈퇴 시까지 (단, 관계 법령에 따라 보존이 필요한 경우 해당 기간)</li>
              <li>서비스 이용 기록: 3년</li>
              <li>불만 또는 분쟁 처리에 관한 기록: 3년</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">4. 개인정보의 제3자 제공</h2>
            <p className="text-gray-700">
              조합은 원칙적으로 정보주체의 개인정보를 제3자에게 제공하지 않습니다. 
              다만, 다음의 경우에는 예외로 합니다.
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2 mt-4">
              <li>정보주체가 사전에 동의한 경우</li>
              <li>법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">5. 정보주체의 권리·의무 및 행사방법</h2>
            <p className="text-gray-700 mb-4">
              정보주체는 조합에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>개인정보 처리현황 통지요구</li>
              <li>개인정보 처리정지 요구</li>
              <li>개인정보의 수정·삭제 요구</li>
              <li>손해배상 청구</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">6. 개인정보보호책임자</h2>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-700 mb-2">
                <strong>개인정보보호책임자:</strong> 최희철
              </p>
              <p className="text-gray-700 mb-2">
                <strong>연락처:</strong> contact@ggac.kr
              </p>
              <p className="text-gray-700">
                개인정보와 관련한 고충사항이 있으시면 언제든지 연락해 주시기 바랍니다.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">7. 개인정보 처리방침 변경</h2>
            <p className="text-gray-700">
              이 개인정보처리방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경내용의 추가, 
              삭제 및 정정이 있는 경우에는 변경사항의 시행 7일 전부터 공지사항을 통하여 고지할 것입니다.
            </p>
          </section>

          <div className="border-t pt-6 mt-8">
            <p className="text-sm text-gray-600">
              <strong>시행일자:</strong> 2025년 7월 7일<br/>
              <strong>최근 수정일:</strong> 2025년 7월 7일
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}