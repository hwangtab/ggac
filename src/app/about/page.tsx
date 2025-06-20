import Image from 'next/image'
import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '우리의 이야기 | 경기아트콜렉티브 협동조합',
  description: '우리는 예술로 숨 쉬고, 협동으로 길을 냅니다.',
}

interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
}

const AboutPage = () => {
  // 프로젝트 데이터에서 연혁 생성
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]

  // 날짜순으로 정렬 (오래된 것부터)
  const sortedProjects = projectsData.sort(
    (a, b) => new Date(a.publishedDate).getTime() - new Date(b.publishedDate).getTime()
  )

  // 고정 이벤트 (조합 설립 관련)
  const fixedEvents = [
    {
      date: '2025-05-01',
      title: '설립신고',
      description: '경기아트콜렉티브 협동조합 설립신고 완료',
      type: 'milestone'
    },
    {
      date: '2025-05-14',
      title: '법인성립',
      description: '협동조합 법인 등기 완료',
      type: 'milestone'
    }
  ]

  // 프로젝트를 이벤트 형태로 변환
  const projectEvents = sortedProjects.map(project => ({
    date: project.publishedDate,
    title: project.title,
    description: `${project.category} - ${project.description.split('\n')[0]}`,
    type: 'project',
    slug: project.slug,
    category: project.category
  }))

  // 카테고리별 색상 매핑
  const getCategoryColor = (category: string) => {
    switch (category) {
      case '음반·음원': return 'bg-purple-600'
      case '공연·전시': return 'bg-pink-600'
      case '예술교육': return 'bg-green-600'
      case '지원·용역사업': return 'bg-blue-600'
      case '행사': return 'bg-orange-600'
      default: return 'bg-accent-600'
    }
  }

  // 모든 이벤트 통합 및 정렬
  const allEvents = [...fixedEvents, ...projectEvents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="container-custom text-center">
          <h1 className="heading-primary mb-6">
            우리는 예술로 숨 쉬고,<br />
            협동으로 길을 냅니다
          </h1>
          <p className="text-body text-gray-600 max-w-3xl mx-auto">
            경기도의 모든 스튜디오와 무대, 작업실에서 고유한 빛을 발하는 예술가들이 있습니다. 
            우리는 그 빛이 외로이 흔들리지 않도록, 창작의 여정이 지치지 않도록 서로의 손을 잡습니다.
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <h2 className="heading-secondary text-center mb-12">설립 목적</h2>
            <div className="prose prose-lg max-w-none">
              <p className="text-body leading-relaxed mb-6">
                예술가의 열정만으로 창작의 불꽃을 온전히 지키기 어려운 시대에, 우리는 창작의 고독과 불안정한 현실의 벽 앞에 놓여있습니다. 이러한 어려움 속에서 우리는 흩어져 있던 예술가들의 손을 맞잡고 서로의 든든한 버팀목이 되어주고자 합니다. 경기도를 기반으로 활동하는 예술인들이 자발적으로 모여 설립한 생산자 협동조합, '경기아트콜렉티브 협동조합'은 바로 그 희망의 첫걸음입니다.
              </p>
              <p className="text-body leading-relaxed mb-6">
                우리 조합은 자주적·자립적·자치적인 협동조합 활동을 통해 경기도 소재 예술가들을 지원하고, 예술 창작 활동의 지속가능성을 도모하며, 지역사회 문화예술 생태계 활성화에 기여하는 것을 목적으로 합니다. 이를 위해 조합원들의 권익 증진을 위한 교육·훈련 및 정보 제공 활동을 적극적으로 수행하며 예술인의 든든한 동반자가 되겠습니다.
              </p>
              <p className="text-body leading-relaxed mb-6">
                또한, 음원 및 음반 제작·유통, 공연 기획·운영, 문화예술 교육 등 다양한 사업을 추진하여 조합원들의 창작물이 정당한 가치를 인정받고 대중과 만날 수 있는 길을 열 것입니다. 이는 조합원의 경제적 자립을 도와 예술 활동이 삶의 위협이 아닌 원동력이 되게 하는 지속가능한 예술 활동의 기반이 될 것입니다.
              </p>
              <p className="text-body leading-relaxed mb-6">
                우리의 활동 무대는 경기도 전역입니다. 지역 주민 및 학생들을 위한 문화예술 교육사업을 진행하고, 다른 협동조합 및 지역 기관과의 긴밀한 협력을 통해 예술이 모두의 일상에 자연스럽게 스며드는 문화를 만들고자 합니다. 창작자, 기획자, 후원 조합원 등 조합의 뜻에 동의하는 모든 이들이 함께 어우러져 서로에게 영감을 주고 새로운 도전을 응원하는 문화 공동체를 지향합니다.
              </p>
              <p className="text-body leading-relaxed mb-6">
                경기아트콜렉티브 협동조합은 예술가 개개인의 꿈이 모여 더 큰 세상을 만드는 광장입니다. 예술가의 권리가 존중받고, 창작의 기쁨이 넘치며, 그 결실을 지역사회와 함께 나누는 미래를 향한 여정에 여러분의 따뜻한 관심과 동참을 기다립니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Chairman Message */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="heading-secondary mb-4">이사장 메시지</h2>
              <div className="w-64 h-64 rounded-full mx-auto mb-8 overflow-hidden border-6 border-white shadow-xl">
                <Image
                  src="/images/artists/boss.webp"
                  alt="이사장 최희철"
                  width={256}
                  height={256}
                  className="w-full h-full object-cover"
                />
              </div>
              <p className="text-lg text-gray-600 font-medium">이사장 최희철</p>
            </div>
            
            <div className="bg-white rounded-2xl p-8 shadow-lg">
              <blockquote className="text-body italic leading-relaxed">
                "동료 예술가들에게. 안녕하세요, 경기아트콜렉티브 협동조합 이사장 최희철입니다. 
                '혼자'라는 단어가 주는 막막함을 누구보다 잘 압니다. 우리의 만남이 그 막막함 속에 
                따뜻한 길 하나를 내주리라 믿습니다."
              </blockquote>
              <br />
              <blockquote className="text-body italic leading-relaxed">
                "이곳에서는 당신의 성공뿐만 아니라 실패와 고민까지도 소중한 자산이 됩니다. 
                주저하지 말고 당신의 목소리를 들려주세요. 우리는 언제나 귀 기울일 준비가 되어있습니다."
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <h2 className="heading-secondary text-center mb-12">시간의 흔적</h2>
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              {/* Timeline Line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-primary-200"></div>
              
              {/* Timeline Items */}
              <div className="space-y-8">
                {allEvents.map((event, index) => (
                  <div key={index} className="relative flex items-start">
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center relative z-10 ${
                      event.type === 'milestone' 
                        ? 'bg-primary-600' 
                        : event.type === 'project' && 'category' in event
                          ? getCategoryColor(event.category as string)
                          : 'bg-gray-400'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full"></div>
                    </div>
                    <div className="ml-6">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`text-sm font-medium ${
                          event.type === 'milestone' 
                            ? 'text-primary-600' 
                            : event.type === 'project' 
                              ? 'text-gray-700' 
                              : 'text-gray-600'
                        }`}>
                          {new Date(event.date).toLocaleDateString('ko-KR')}
                        </div>
                        {event.type === 'project' && 'category' in event && (
                          <span className={`px-2 py-1 text-xs font-medium text-white rounded-full ${getCategoryColor(event.category as string)}`}>
                            {event.category as string}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold mb-2">
                        {event.type === 'project' && 'slug' in event ? (
                          <Link 
                            href={`/archive/${event.slug}`}
                            className="hover:text-primary-600 transition-colors duration-200"
                          >
                            {event.title}
                          </Link>
                        ) : (
                          event.title
                        )}
                      </h3>
                      <p className="text-gray-600 text-sm leading-relaxed">
                        {event.type === 'project' 
                          ? event.description.replace(/^[^-]*-\s*/, '') // 카테고리 부분 제거
                          : event.description
                        }
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default AboutPage
