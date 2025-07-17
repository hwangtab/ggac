import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '이용약관 - 경기아트콜렉티브 협동조합',
  description: '경기아트콜렉티브 협동조합 웹사이트 이용약관을 확인하세요. 서비스 이용 시 준수해야 할 규정과 조건들을 안내합니다.',
  keywords: ['이용약관', '서비스 약관', '경기아트콜렉티브', '협동조합', '웹사이트 이용규정'],
  openGraph: {
    title: '이용약관 - 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브 협동조합 웹사이트 이용약관을 확인하세요.',
    type: 'website'
  },
  robots: {
    index: true,
    follow: true
  }
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white pt-24 md:pt-28 pb-12">
      <div className="container-custom">
        <div className="max-w-4xl mx-auto">
          <h1 className="heading-primary text-gray-900 mb-8">이용약관</h1>
          
          <div className="prose prose-lg max-w-none">
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제1조 (목적)</h2>
              <p className="text-gray-700 leading-relaxed">
                이 약관은 경기아트콜렉티브 협동조합(이하 "조합")이 제공하는 웹사이트 서비스의 이용조건 및 절차, 
                조합과 회원간의 권리, 의무, 책임사항 기타 필요한 사항을 규정함을 목적으로 합니다.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제2조 (정의)</h2>
              <p className="text-gray-700 leading-relaxed mb-4">이 약관에서 사용하는 용어의 정의는 다음과 같습니다:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>"조합"이라 함은 경기아트콜렉티브 협동조합을 의미합니다.</li>
                <li>"서비스"라 함은 조합이 제공하는 웹사이트 및 관련 서비스를 의미합니다.</li>
                <li>"회원"이라 함은 조합에 가입하여 서비스를 이용하는 자를 의미합니다.</li>
                <li>"게시물"이라 함은 회원이 서비스에 게재한 문자, 이미지, 영상 등의 정보를 의미합니다.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제3조 (약관의 효력 및 변경)</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                1. 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 회원에게 공지함으로써 효력을 발생합니다.
              </p>
              <p className="text-gray-700 leading-relaxed">
                2. 조합은 관련 법령에 위배되지 않는 범위에서 이 약관을 개정할 수 있으며, 
                개정된 약관은 제1항과 같은 방법으로 공지 또는 통지함으로써 효력을 발생합니다.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제4조 (서비스의 제공)</h2>
              <p className="text-gray-700 leading-relaxed mb-4">조합이 제공하는 서비스는 다음과 같습니다:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>조합 및 소속 아티스트 정보 제공</li>
                <li>프로젝트 및 작품 아카이브 서비스</li>
                <li>조합원 간 소통을 위한 게시판 서비스</li>
                <li>기타 조합이 정하는 서비스</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제5조 (회원가입)</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                1. 회원가입은 이용자가 약관의 내용에 대하여 동의하고 회원가입신청을 한 후 
                조합이 이러한 신청에 대하여 승낙함으로써 체결됩니다.
              </p>
              <p className="text-gray-700 leading-relaxed">
                2. 조합은 다음 각 호에 해당하는 신청에 대하여는 승낙하지 않을 수 있습니다:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-2">
                <li>가입신청자가 이 약관에 의하여 이전에 회원자격을 상실한 적이 있는 경우</li>
                <li>실명이 아니거나 타인의 명의를 이용한 경우</li>
                <li>허위의 정보를 기재하거나, 조합이 제시하는 내용을 기재하지 않은 경우</li>
                <li>기타 회원으로 등록하는 것이 조합의 기술상 현저히 지장이 있다고 판단되는 경우</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제6조 (회원의 의무)</h2>
              <p className="text-gray-700 leading-relaxed mb-4">회원은 다음 각 호의 행위를 하여서는 안 됩니다:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>신청 또는 변경시 허위내용의 등록</li>
                <li>타인의 정보 도용</li>
                <li>조합이 게시한 정보의 변경</li>
                <li>조합이 금지한 정보(컴퓨터 프로그램 등)의 송신 또는 게시</li>
                <li>조합 기타 제3자의 저작권 등 지적재산권에 대한 침해</li>
                <li>조합 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위</li>
                <li>외설 또는 폭력적인 메시지, 화상, 음성 기타 공서양속에 반하는 정보를 서비스에 공개 또는 게시하는 행위</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제7조 (개인정보보호)</h2>
              <p className="text-gray-700 leading-relaxed">
                조합은 관련법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력합니다. 
                개인정보의 보호 및 사용에 대해서는 관련법령 및 조합의 개인정보처리방침이 적용됩니다.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">제8조 (면책조항)</h2>
              <p className="text-gray-700 leading-relaxed">
                조합은 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 
                서비스 제공에 관한 책임이 면제됩니다.
              </p>
            </section>

            <div className="mt-12 pt-8 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                시행일자: 2025년 5월 1일<br />
                본 약관에 대한 문의사항이 있으시면 contact@gac.coop로 연락주시기 바랍니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}