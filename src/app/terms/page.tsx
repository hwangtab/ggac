export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-20 pt-32">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">서비스 이용약관</h1>
        
        <div className="max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제1조 (목적)</h2>
            <p className="text-gray-700">
              이 약관은 경기아트콜렉티브 협동조합(이하 "조합")이 제공하는 웹사이트 및 관련 서비스의 
              이용과 관련하여 조합과 이용자 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제2조 (정의)</h2>
            <p className="text-gray-700 mb-4">이 약관에서 사용하는 용어의 정의는 다음과 같습니다.</p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>"서비스"라 함은 조합이 제공하는 모든 인터넷 서비스를 의미합니다.</li>
              <li>"이용자"라 함은 조합의 서비스에 접속하여 이 약관에 따라 조합이 제공하는 서비스를 받는 회원 및 비회원을 의미합니다.</li>
              <li>"회원"이라 함은 조합에 개인정보를 제공하여 회원등록을 한 자로서, 조합의 정보를 지속적으로 제공받으며, 조합이 제공하는 서비스를 계속적으로 이용할 수 있는 자를 의미합니다.</li>
              <li>"비회원"이라 함은 회원에 가입하지 않고 조합이 제공하는 서비스를 이용하는 자를 의미합니다.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제3조 (약관의 효력 및 변경)</h2>
            <div className="space-y-4">
              <p className="text-gray-700">
                ① 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력을 발생합니다.
              </p>
              <p className="text-gray-700">
                ② 조합은 필요하다고 인정되는 경우 이 약관을 변경할 수 있으며, 변경된 약관은 제1항과 같은 방법으로 공지 또는 통지함으로써 효력을 발생합니다.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제4조 (조합원 가입)</h2>
            <div className="space-y-4">
              <p className="text-gray-700">
                ① 이용자는 조합이 정한 가입 양식에 따라 회원정보를 기입한 후 이 약관에 동의한다는 의사표시를 함으로써 조합원 가입을 신청합니다.
              </p>
              <p className="text-gray-700">
                ② 조합은 제1항과 같이 회원으로 가입할 것을 신청한 이용자 중 다음 각 호에 해당하지 않는 한 회원으로 등록합니다.
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
                <li>가입신청자가 이 약관에 의하여 이전에 회원자격을 상실한 적이 있는 경우</li>
                <li>등록 내용에 허위, 기재누락, 오기가 있는 경우</li>
                <li>기타 회원으로 등록하는 것이 조합의 기술상 현저히 지장이 있다고 판단되는 경우</li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제5조 (서비스의 제공 및 변경)</h2>
            <div className="space-y-4">
              <p className="text-gray-700">
                ① 조합은 회원에게 아래와 같은 서비스를 제공합니다.
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
                <li>아티스트 및 작품 정보 제공 서비스</li>
                <li>프로젝트 및 전시 정보 제공 서비스</li>
                <li>조합원 게시판 및 커뮤니티 서비스</li>
                <li>기타 조합이 정하는 서비스</li>
              </ul>
              <p className="text-gray-700">
                ② 조합은 서비스의 내용을 변경할 수 있으며, 변경 시에는 변경사유 및 제공일자를 명시하여 현재의 서비스가 제공되고 있는 화면에 게시하여야 합니다.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제6조 (서비스의 중단)</h2>
            <p className="text-gray-700">
              조합은 컴퓨터 등 정보통신설비의 보수점검·교체 및 고장, 통신의 두절 등의 사유가 발생한 경우에는 
              서비스의 제공을 일시적으로 중단할 수 있습니다.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제7조 (회원의 의무)</h2>
            <div className="space-y-4">
              <p className="text-gray-700">① 이용자는 다음 행위를 하여서는 안됩니다.</p>
              <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                <li>신청 또는 변경시 허위내용의 등록</li>
                <li>타인의 정보도용</li>
                <li>조합에 게시된 정보의 변경</li>
                <li>조합이 정한 정보 이외의 정보(컴퓨터 프로그램 등)의 송신 또는 게시</li>
                <li>조합 기타 제3자의 저작권 등 지적재산권에 대한 침해</li>
                <li>조합 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위</li>
                <li>외설 또는 폭력적인 메시지, 화상, 음성, 기타 공서양속에 반하는 정보를 서비스에 공개 또는 게시하는 행위</li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제8조 (저작권의 귀속 및 이용제한)</h2>
            <div className="space-y-4">
              <p className="text-gray-700">
                ① 조합이 작성한 저작물에 대한 저작권 기타 지적재산권은 조합에 귀속합니다.
              </p>
              <p className="text-gray-700">
                ② 이용자는 조합을 이용함으로써 얻은 정보 중 조합에게 지적재산권이 귀속된 정보를 조합의 
                사전 승낙 없이 복제, 송신, 출판, 배포, 방송 기타 방법에 의하여 영리목적으로 이용하거나 
                제3자에게 이용하게 하여서는 안됩니다.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제9조 (분쟁해결)</h2>
            <p className="text-gray-700">
              ① 조합은 이용자가 제기하는 정당한 의견이나 불만을 반영하고 그 피해를 보상처리하기 위하여 
              피해보상처리기구를 설치·운영합니다.
            </p>
            <p className="text-gray-700 mt-4">
              ② 조합과 이용자 간에 발생한 전자상거래 분쟁에 관한 소송은 서울중앙지방법원의 관할로 합니다.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">제10조 (연락처)</h2>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-700 mb-2">
                <strong>조합명:</strong> 경기아트콜렉티브 협동조합
              </p>
              <p className="text-gray-700 mb-2">
                <strong>이메일:</strong> contact@ggac.kr
              </p>
              <p className="text-gray-700">
                <strong>웹사이트:</strong> https://ggac.kr
              </p>
            </div>
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