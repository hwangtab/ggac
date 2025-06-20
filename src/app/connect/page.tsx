import fs from 'fs'
import path from 'path'
import { FaInstagram, FaYoutube } from 'react-icons/fa'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '소통과 참여 | 경기아트콜렉티브 협동조합',
  description: '당신의 참여로 새로운 물결이 시작됩니다.',
}

interface GlobalData {
  siteName: string
  siteDescription: string
  joinFormUrl: string
  supportFormUrl: string
  contact: {
    email: string
    phone: string
    address: string
  }
  social: {
    instagram: string
    youtube: string
  }
}

const ConnectPage = () => {
  const globalData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/global.json'), 'utf8')
  ) as GlobalData

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="container-custom text-center">
          <h1 className="heading-primary mb-6">
            당신의 참여로<br />
            새로운 물결이 시작됩니다
          </h1>
          <p className="text-body text-gray-600 max-w-3xl mx-auto">
            경기아트콜렉티브와 함께 예술의 새로운 가능성을 만들어가세요. 
            동료가 되어주시거나, 우리의 활동을 응원해 주시는 모든 분들을 환영합니다.
          </p>
        </div>
      </section>

      {/* Join Section */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="heading-secondary mb-4">함께 흐를까요?</h2>
              <p className="text-body text-gray-600">
                경기도를 기반으로 활동하는 예술가, 기획자, 그리고 우리의 취지에 공감하는 모든 분들과 함께하고 싶습니다.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-12">
              {/* 자격 */}
              <div className="bg-white rounded-2xl p-8 shadow-lg h-full">
                <h3 className="text-xl font-serif font-semibold mb-6 text-center text-primary-600">자격</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                      <span className="w-2 h-2 bg-primary-600 rounded-full mr-3"></span>
                      경기도 기반 예술가
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed ml-5">
                      경기도에 거주하거나 활동하는 모든 분야의 예술가
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                      <span className="w-2 h-2 bg-primary-600 rounded-full mr-3"></span>
                      문화예술 기획자
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed ml-5">
                      문화예술 기획, 제작, 운영 등의 활동을 하는 전문가
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                      <span className="w-2 h-2 bg-primary-600 rounded-full mr-3"></span>
                      동참 희망자
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed ml-5">
                      조합의 취지에 동의하고 예술 생태계 발전에 기여하고자 하는 모든 분
                    </p>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <p className="text-sm text-gray-500 text-center">
                    예술가와 기획자, 그리고 예술을 사랑하는 모든 분들을 환영합니다.
                  </p>
                </div>
              </div>

              {/* 약속 */}
              <div className="bg-white rounded-2xl p-8 shadow-lg h-full">
                <h3 className="text-xl font-serif font-semibold mb-6 text-center text-accent-600">약속</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                      <span className="w-2 h-2 bg-accent-600 rounded-full mr-3"></span>
                      출자금
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed ml-5">
                      조합원이 되기 위해 최소 1좌(10,000원) 이상의 출자가 필요합니다. 
                      출자금은 조합의 소중한 자본금이 되며, 탈퇴 시 정관에 따라 환급됩니다.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                      <span className="w-2 h-2 bg-accent-600 rounded-full mr-3"></span>
                      월 회비
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed ml-5">
                      조합 운영을 위해 월 10,000원의 회비가 있습니다. 
                      (이사회 의결로 조정 가능)
                    </p>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <p className="text-sm text-gray-500 text-center leading-relaxed">
                    조합원의 능동적인 참여를 통해 함께 성장하는 지속가능한 공동체를 만들어갑니다. 이는 조합원이 지닌 역량과 가치를 발휘하며 물질적, 정신적으로 상호 협력하는 과정을 통해 이루어집니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-center">
              <a 
                href={globalData.joinFormUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-lg px-8 py-4"
              >
                동료 되기 (신청서 작성하기)
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Support Section */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="heading-secondary mb-6">예술의 씨앗에 물을 주세요</h2>
            <p className="text-body text-gray-600 mb-8 max-w-2xl mx-auto">
              직접 조합원이 되지 않더라도, 후원을 통해 경기 지역 예술 생태계 발전에 함께할 수 있습니다. 
              여러분의 관심과 지원이 예술가들에게 큰 힘이 됩니다.
            </p>
            
            <a 
              href={globalData.supportFormUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-lg px-8 py-4"
            >
              예술 생태계 가꾸기 (후원 문의하기)
            </a>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="heading-secondary mb-4">연락처</h2>
              <p className="text-body text-gray-600">
                궁금한 점이 있으시거나 더 자세한 이야기를 나누고 싶으시면 언제든 연락해 주세요.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 text-center">
              <a 
                href={`mailto:${globalData.contact.email}`}
                className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
              >
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                  <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">@</span>
                </div>
                <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">이메일</h3>
                <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                  {globalData.contact.email}
                </p>
              </a>

              <a 
                href={`tel:${globalData.contact.phone}`}
                className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
              >
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                  <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">📞</span>
                </div>
                <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">전화</h3>
                <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                  {globalData.contact.phone}
                </p>
              </a>

              <a 
                href={`https://map.naver.com/v5/search/${encodeURIComponent(globalData.contact.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
              >
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                  <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">📍</span>
                </div>
                <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">주소</h3>
                <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                  {globalData.contact.address}
                </p>
              </a>
            </div>

            <div className="text-center mt-12">
              <p className="text-gray-600 mb-6">SNS에서도 만나보세요</p>
              <div className="flex justify-center space-x-8">
                <a 
                  href={globalData.social.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center text-gray-600 hover:text-pink-600 transition-all duration-200 group transform hover:scale-105"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 rounded-xl flex items-center justify-center mb-2 group-hover:shadow-lg transition-shadow duration-200">
                    <FaInstagram className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-sm font-medium">Instagram</span>
                </a>
                <a 
                  href={globalData.social.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center text-gray-600 hover:text-red-600 transition-all duration-200 group transform hover:scale-105"
                >
                  <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center mb-2 group-hover:shadow-lg transition-shadow duration-200">
                    <FaYoutube className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-sm font-medium">YouTube</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default ConnectPage
