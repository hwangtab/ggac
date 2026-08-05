import { generateBreadcrumbStructuredData, structuredDataToScript } from '@/utils/structuredData'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  return {
    title: isEn ? 'Privacy Policy' : '개인정보처리방침',
    description: isEn
      ? 'Privacy Policy for the Gyeonggi Art Collective website.'
      : '경기아트콜렉티브 협동조합의 개인정보처리방침입니다. 개인정보를 어떻게 모으고 쓰고 보관하고 지우는지 적어 뒀습니다.',
    keywords: ['개인정보처리방침', '개인정보보호', '경기아트콜렉티브', '협동조합', '개인정보 정책'],
    alternates: getLocaleAlternates('/privacy', locale),
    openGraph: {
      title: isEn
        ? 'Privacy Policy | Gyeonggi Art Collective'
        : '개인정보처리방침 - 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Privacy Policy for the Gyeonggi Art Collective website.'
        : '경기아트콜렉티브 협동조합의 개인정보처리방침입니다.',
      url: isEn ? `${base}/en/privacy` : `${base}/privacy`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      type: 'website',
      locale: getOgLocale(locale),
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합',
        },
      ],
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

const privacyJsonLd = structuredDataToScript(
  generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '개인정보처리방침', url: 'https://ggac.kr/privacy' },
  ])
)

interface PrivacyPageProps {
  params: Promise<{ locale: string }>
}

function PrivacyContentEn() {
  return (
    <div className="prose prose-lg max-w-none">
      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          1. Purpose of Processing Personal Information
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Gyeonggi Art Collective Cooperative (hereinafter "the Cooperative") processes personal
          information for the following purposes:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>Member registration and management</li>
          <li>Service provision and contract fulfillment</li>
          <li>Providing information related to Cooperative activities</li>
          <li>Handling inquiries and complaints</li>
          <li>
            Fulfilling obligations under applicable laws and the Cooperative&apos;s articles of
            incorporation
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          2. Personal Information Retention Period
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          The Cooperative processes and retains personal information within the period consented to
          at the time of collection or as required by applicable law.
        </p>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-2">Retention periods:</h3>
          <ul className="list-disc pl-6 text-gray-700 space-y-1">
            <li>Member information: Until withdrawal from membership</li>
            <li>Service usage records: 3 years</li>
            <li>Legally mandated records: As specified by applicable law</li>
          </ul>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          3. Personal Information Items Processed
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          The Cooperative processes the following personal information:
        </p>
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Required</h3>
            <ul className="list-disc pl-6 text-gray-700 space-y-1">
              <li>Email address, password</li>
              <li>Legal name, display name</li>
              <li>Phone number, date of birth</li>
              <li>Bank account information (bank name, account number, account holder)</li>
            </ul>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Automatically Collected</h3>
            <ul className="list-disc pl-6 text-gray-700 space-y-1">
              <li>IP address, cookies, access logs</li>
              <li>Service usage records, abuse records</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          4. Provision of Personal Information to Third Parties
        </h2>
        <p className="text-gray-700 leading-relaxed">
          The Cooperative processes personal information only within the scope stated in Article 1
          and provides it to third parties only with the data subject&apos;s consent or as permitted
          under applicable personal information protection laws.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          5. Delegation of Personal Information Processing
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          The Cooperative delegates personal information processing as follows:
        </p>
        <div className="bg-gray-50 p-4 rounded-lg">
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li>
              <strong>Supabase Inc.</strong>: Database management and user authentication services
            </li>
            <li>
              <strong>Vercel Inc.</strong>: Website hosting and deployment services
            </li>
          </ul>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Rights of Data Subjects</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Data subjects may exercise the following rights against the Cooperative at any time:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>Request notification of personal information processing status</li>
          <li>Request suspension of personal information processing</li>
          <li>Request correction or deletion of personal information</li>
          <li>Claim damages</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          7. Security Measures for Personal Information
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          The Cooperative takes the following measures to ensure the security of personal
          information:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>Minimizing and training staff who handle personal information</li>
          <li>Restricting access to personal information</li>
          <li>Protecting personal information through encryption</li>
          <li>Technical measures against hacking and other threats</li>
          <li>Managing access permissions to personal information systems</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          8. Personal Information Protection Officer
        </h2>
        <div className="bg-blue-50 p-6 rounded-lg">
          <p className="text-gray-700 leading-relaxed mb-4">
            The Cooperative has designated a Personal Information Protection Officer responsible for
            overseeing personal information processing and handling data subject complaints:
          </p>
          <div className="space-y-2">
            <p>
              <strong>Personal Information Protection Officer</strong>
            </p>
            <p>Email: privacy@gac.coop</p>
            <p>Phone: 0507-1384-3144</p>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          9. Changes to This Privacy Policy
        </h2>
        <p className="text-gray-700 leading-relaxed">
          This Privacy Policy is effective from the date stated below. Any additions, deletions, or
          corrections will be announced through the notice board at least 7 days before taking
          effect.
        </p>
      </section>

      <div className="mt-12 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Effective Date: May 1, 2025
          <br />
          For inquiries about this Privacy Policy, please contact privacy@gac.coop.
        </p>
      </div>
    </div>
  )
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      {privacyJsonLd}
      <div className="min-h-screen bg-white pt-24 md:pt-28 pb-12">
        <div className="tw-container-custom">
          <div className="max-w-4xl mx-auto">
            <h1 className="tw-heading-primary text-gray-900 mb-8">
              {locale === 'en' ? 'Privacy Policy' : '개인정보처리방침'}
            </h1>
            {locale === 'en' ? (
              <PrivacyContentEn />
            ) : (
              <div className="prose prose-lg max-w-none">
                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    1. 개인정보의 처리 목적
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    경기아트콜렉티브 협동조합(이하 "조합")은 다음의 목적을 위하여 개인정보를
                    처리합니다:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>조합원 가입 및 관리</li>
                    <li>서비스 제공 및 계약 이행</li>
                    <li>조합 활동 관련 정보 제공</li>
                    <li>문의사항 및 민원 처리</li>
                    <li>법령 및 조합 정관에 따른 의무 이행</li>
                  </ul>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    2. 개인정보의 처리 및 보유기간
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    조합은 법령에 따른 개인정보 보유・이용기간 또는 정보주체로부터 개인정보를
                    수집시에 동의받은 개인정보 보유・이용기간 내에서 개인정보를 처리・보유합니다.
                  </p>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-2">
                      구체적인 개인정보 처리 및 보유기간:
                    </h3>
                    <ul className="list-disc pl-6 text-gray-700 space-y-1">
                      <li>조합원 정보: 조합원 탈퇴 시까지</li>
                      <li>서비스 이용 기록: 3년</li>
                      <li>법령에 의한 보관 의무가 있는 정보: 해당 법령에서 정한 기간</li>
                    </ul>
                  </div>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    3. 처리하는 개인정보의 항목
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    조합이 처리하는 개인정보의 항목은 다음과 같습니다:
                  </p>

                  <div className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h3 className="font-semibold text-gray-900 mb-2">필수항목</h3>
                      <ul className="list-disc pl-6 text-gray-700 space-y-1">
                        <li>이메일 주소, 비밀번호</li>
                        <li>실명, 표시명</li>
                        <li>전화번호, 생년월일</li>
                        <li>계좌정보(은행명, 계좌번호, 예금주)</li>
                      </ul>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                      <h3 className="font-semibold text-gray-900 mb-2">자동 수집 항목</h3>
                      <ul className="list-disc pl-6 text-gray-700 space-y-1">
                        <li>접속 IP 정보, 쿠키, 접속 기록</li>
                        <li>서비스 이용 기록, 불량 이용 기록</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    4. 개인정보의 제3자 제공
                  </h2>
                  <p className="text-gray-700 leading-relaxed">
                    조합은 개인정보를 제1조(개인정보의 처리 목적)에서 명시한 범위 내에서만 처리하며,
                    정보주체의 동의, 법률의 특별한 규정 등 개인정보 보호법 제17조 및 제18조에
                    해당하는 경우에만 제3자에게 제공합니다.
                  </p>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    5. 개인정보처리의 위탁
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    조합은 원활한 개인정보 업무처리를 위하여 다음과 같이 개인정보 처리업무를
                    위탁하고 있습니다:
                  </p>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <ul className="list-disc pl-6 text-gray-700 space-y-2">
                      <li>
                        <strong>Supabase Inc.</strong>: 데이터베이스 관리 및 사용자 인증 서비스
                      </li>
                      <li>
                        <strong>Vercel Inc.</strong>: 웹사이트 호스팅 및 배포 서비스
                      </li>
                    </ul>
                  </div>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    6. 정보주체의 권리・의무
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    정보주체는 조합에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수
                    있습니다:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>개인정보 처리현황 통지요구</li>
                    <li>개인정보 처리정지 요구</li>
                    <li>개인정보의 정정・삭제 요구</li>
                    <li>손해배상 청구</li>
                  </ul>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    7. 개인정보의 안전성 확보조치
                  </h2>
                  <p className="text-gray-700 leading-relaxed mb-4">
                    조합은 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>개인정보 취급 직원의 최소화 및 교육</li>
                    <li>개인정보에 대한 접근 제한</li>
                    <li>암호화를 통한 개인정보 보호</li>
                    <li>해킹 등에 대비한 기술적 대책</li>
                    <li>개인정보처리시스템 접근권한의 관리</li>
                  </ul>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    8. 개인정보보호책임자
                  </h2>
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <p className="text-gray-700 leading-relaxed mb-4">
                      조합은 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한
                      정보주체의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보보호책임자를
                      지정하고 있습니다:
                    </p>
                    <div className="space-y-2">
                      <p>
                        <strong>개인정보보호책임자</strong>
                      </p>
                      <p>이메일: privacy@gac.coop</p>
                      <p>전화번호: 0507-1384-3144</p>
                    </div>
                  </div>
                </section>

                <section className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    9. 개인정보 처리방침 변경
                  </h2>
                  <p className="text-gray-700 leading-relaxed">
                    이 개인정보처리방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경내용의
                    추가, 삭제 및 정정이 있는 경우에는 변경사항의 시행 7일 전부터 공지사항을 통하여
                    고지할 것입니다.
                  </p>
                </section>

                <div className="mt-12 pt-8 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    시행일자: 2025년 5월 1일
                    <br />본 개인정보처리방침에 대한 문의사항이 있으시면 privacy@gac.coop로
                    연락주시기 바랍니다.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
