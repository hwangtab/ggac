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
    title: isEn ? 'Terms of Use' : '이용약관',
    description: isEn
      ? 'Terms of Use for the Gyeonggi Art Collective website.'
      : '경기아트콜렉티브 협동조합 웹사이트 이용약관을 확인하세요. 서비스 이용 시 준수해야 할 규정과 조건들을 안내합니다.',
    keywords: ['이용약관', '서비스 약관', '경기아트콜렉티브', '협동조합', '웹사이트 이용규정'],
    alternates: getLocaleAlternates('/terms', locale),
    openGraph: {
      title: isEn
        ? 'Terms of Use | Gyeonggi Art Collective'
        : '이용약관 - 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Terms of Use for the Gyeonggi Art Collective website.'
        : '경기아트콜렉티브 협동조합 웹사이트 이용약관을 확인하세요.',
      url: isEn ? `${base}/en/terms` : `${base}/terms`,
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

const termsJsonLd = structuredDataToScript(
  generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '이용약관', url: 'https://ggac.kr/terms' },
  ])
)

interface TermsPageProps {
  params: Promise<{ locale: string }>
}

function TermsContentEn() {
  return (
    <div className="prose prose-lg max-w-none">
      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 1 (Purpose)</h2>
        <p className="text-gray-700 leading-relaxed">
          These Terms of Service define the conditions and procedures for using the website services
          provided by Gyeonggi Art Collective Cooperative (hereinafter "the Cooperative"), as well
          as the rights, obligations, and responsibilities between the Cooperative and its members.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 2 (Definitions)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Terms used in these Terms of Service are defined as follows:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>"Cooperative" refers to Gyeonggi Art Collective Cooperative.</li>
          <li>"Service" refers to the website and related services provided by the Cooperative.</li>
          <li>"Member" refers to a person who has joined the Cooperative and uses the Service.</li>
          <li>"Post" refers to information such as text, images, or videos posted by a member on the Service.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 3 (Effectiveness and Amendment of Terms)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          1. These Terms of Service take effect by being posted on the Service screen or notified to members by other means.
        </p>
        <p className="text-gray-700 leading-relaxed">
          2. The Cooperative may amend these Terms of Service within the scope permitted by applicable laws, and amended terms take effect by being announced or notified in the same manner as paragraph 1.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 4 (Provision of Services)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          The Cooperative provides the following services:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>Information about the Cooperative and its affiliated artists</li>
          <li>Project and artwork archive service</li>
          <li>Community board for communication among members</li>
          <li>Other services determined by the Cooperative</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 5 (Member Registration)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          1. Membership is established when a user agrees to these Terms, submits a membership application, and the Cooperative approves such application.
        </p>
        <p className="text-gray-700 leading-relaxed">
          2. The Cooperative may decline applications in the following cases:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-2">
          <li>The applicant has previously lost membership status under these Terms</li>
          <li>The applicant uses a pseudonym or another person&apos;s identity</li>
          <li>The applicant provides false information or omits required information</li>
          <li>Other cases where the Cooperative deems membership technically problematic</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 6 (Member Obligations)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Members must not engage in the following activities:
        </p>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li>Registering false information during application or modification</li>
          <li>Stealing or misusing another person&apos;s information</li>
          <li>Altering information posted by the Cooperative</li>
          <li>Transmitting or posting prohibited content (e.g., malware)</li>
          <li>Infringing on the intellectual property rights of the Cooperative or third parties</li>
          <li>Damaging the reputation of or interfering with the Cooperative or third parties</li>
          <li>Distributing obscene, violent, or otherwise inappropriate content on the Service</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 7 (Protection of Personal Information)</h2>
        <p className="text-gray-700 leading-relaxed">
          The Cooperative endeavors to protect members&apos; personal information in accordance with
          applicable laws. The handling and use of personal information are governed by applicable
          laws and the Cooperative&apos;s Privacy Policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Article 8 (Disclaimer)</h2>
        <p className="text-gray-700 leading-relaxed">
          The Cooperative is exempt from liability for service disruptions caused by force majeure
          events such as natural disasters or equivalent circumstances beyond its control.
        </p>
      </section>

      <div className="mt-12 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Effective Date: May 1, 2025
          <br />For inquiries about these Terms, please contact contact@gac.coop.
        </p>
      </div>
    </div>
  )
}

export default async function TermsPage({ params }: TermsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      {termsJsonLd}
      <div className="min-h-screen bg-white pt-24 md:pt-28 pb-12">
        <div className="tw-container-custom">
          <div className="max-w-4xl mx-auto">
            <h1 className="tw-heading-primary text-gray-900 mb-8">
              {locale === 'en' ? 'Terms of Service' : '이용약관'}
            </h1>
            {locale === 'en' ? (
              <TermsContentEn />
            ) : (
            <div className="prose prose-lg max-w-none">
              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제1조 (목적)</h2>
                <p className="text-gray-700 leading-relaxed">
                  이 약관은 경기아트콜렉티브 협동조합(이하 "조합")이 제공하는 웹사이트 서비스의
                  이용조건 및 절차, 조합과 회원간의 권리, 의무, 책임사항 기타 필요한 사항을 규정함을
                  목적으로 합니다.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제2조 (정의)</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  이 약관에서 사용하는 용어의 정의는 다음과 같습니다:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>"조합"이라 함은 경기아트콜렉티브 협동조합을 의미합니다.</li>
                  <li>"서비스"라 함은 조합이 제공하는 웹사이트 및 관련 서비스를 의미합니다.</li>
                  <li>"회원"이라 함은 조합에 가입하여 서비스를 이용하는 자를 의미합니다.</li>
                  <li>
                    "게시물"이라 함은 회원이 서비스에 게재한 문자, 이미지, 영상 등의 정보를
                    의미합니다.
                  </li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  제3조 (약관의 효력 및 변경)
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  1. 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 회원에게 공지함으로써 효력을
                  발생합니다.
                </p>
                <p className="text-gray-700 leading-relaxed">
                  2. 조합은 관련 법령에 위배되지 않는 범위에서 이 약관을 개정할 수 있으며, 개정된
                  약관은 제1항과 같은 방법으로 공지 또는 통지함으로써 효력을 발생합니다.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제4조 (서비스의 제공)</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  조합이 제공하는 서비스는 다음과 같습니다:
                </p>
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
                  1. 회원가입은 이용자가 약관의 내용에 대하여 동의하고 회원가입신청을 한 후 조합이
                  이러한 신청에 대하여 승낙함으로써 체결됩니다.
                </p>
                <p className="text-gray-700 leading-relaxed">
                  2. 조합은 다음 각 호에 해당하는 신청에 대하여는 승낙하지 않을 수 있습니다:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-2">
                  <li>가입신청자가 이 약관에 의하여 이전에 회원자격을 상실한 적이 있는 경우</li>
                  <li>실명이 아니거나 타인의 명의를 이용한 경우</li>
                  <li>허위의 정보를 기재하거나, 조합이 제시하는 내용을 기재하지 않은 경우</li>
                  <li>
                    기타 회원으로 등록하는 것이 조합의 기술상 현저히 지장이 있다고 판단되는 경우
                  </li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제6조 (회원의 의무)</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  회원은 다음 각 호의 행위를 하여서는 안 됩니다:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>신청 또는 변경시 허위내용의 등록</li>
                  <li>타인의 정보 도용</li>
                  <li>조합이 게시한 정보의 변경</li>
                  <li>조합이 금지한 정보(컴퓨터 프로그램 등)의 송신 또는 게시</li>
                  <li>조합 기타 제3자의 저작권 등 지적재산권에 대한 침해</li>
                  <li>조합 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위</li>
                  <li>
                    외설 또는 폭력적인 메시지, 화상, 음성 기타 공서양속에 반하는 정보를 서비스에
                    공개 또는 게시하는 행위
                  </li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제7조 (개인정보보호)</h2>
                <p className="text-gray-700 leading-relaxed">
                  조합은 관련법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력합니다.
                  개인정보의 보호 및 사용에 대해서는 관련법령 및 조합의 개인정보처리방침이
                  적용됩니다.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">제8조 (면책조항)</h2>
                <p className="text-gray-700 leading-relaxed">
                  조합은 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는
                  경우에는 서비스 제공에 관한 책임이 면제됩니다.
                </p>
              </section>

              <div className="mt-12 pt-8 border-t border-gray-200">
                <p className="text-sm text-gray-500">
                  시행일자: 2025년 5월 1일
                  <br />본 약관에 대한 문의사항이 있으시면 contact@gac.coop로 연락주시기 바랍니다.
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
