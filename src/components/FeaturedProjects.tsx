import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { getTranslations, getLocale } from 'next-intl/server'
import { getProjectSummary } from '@/utils/projectUtils'
import { toSafeInternalImagePath } from '@/utils/safeUrl'
import { parseLocalDate } from '@/utils/date'
import type { FeaturedProjectsProps } from '@/types'

/** 2026-07-25 → 2026.07.25 — 포스터의 날짜 스탬프 표기 */
function toStamp(value: string, locale: string): string {
  const date = parseLocalDate(value)
  if (Number.isNaN(date.getTime())) return value
  if (locale === 'en') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

/**
 * 히어로의 포스터 문법을 이어받는 다크 섹션. 흰 카드·그림자·라운드 대신
 * 직각 프레임 + 헤어라인 보더 + 흑백→컬러 hover를 쓴다.
 * 이미지에 priority를 주지 않는다 — 접힘선 아래라 LCP(히어로 텍스트)와
 * 대역폭을 다투기만 한다.
 */
const FeaturedProjects = async ({ projects }: FeaturedProjectsProps) => {
  const t = await getTranslations('home')
  const locale = await getLocale()

  return (
    <section className="py-16 text-white md:py-24">
      <div className="tw-container-custom">
        {/* 킥커 행 — 히어로 하단 밴드와 같은 문법 */}
        <div className="flex items-center gap-3 sm:gap-4">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/65">
            {t('projects.heading')}
          </h2>
          <span className="text-[11px] tabular-nums text-white/60">
            {String(projects.length).padStart(2, '0')}
          </span>
          <span className="h-px flex-1 bg-white/25" />
          <Link
            href="/projects"
            className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/60 transition-colors duration-200 hover:text-white sm:inline-flex"
          >
            {t('projects.viewAll')}
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-base">
          {t('projects.description')}
        </p>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {projects.map((project, index) => {
            const safeCoverImage = toSafeInternalImagePath(project.coverImage)
            const summary = getProjectSummary(project, index === 0 ? 140 : 110)

            return (
              <Link
                key={project.id}
                href={`/projects/${project.slug}`}
                className={`group block border border-white/15 transition-colors duration-300 hover:border-white/50 ${
                  index === 0 ? 'md:col-span-2' : ''
                }`}
              >
                <div
                  className={`relative overflow-hidden ${index === 0 ? 'h-64 md:h-96' : 'h-56 md:h-64'}`}
                >
                  <OptimizedImage
                    src={safeCoverImage}
                    alt={project.title}
                    width={index === 0 ? 1600 : 800}
                    height={index === 0 ? 900 : 600}
                    className="h-full w-full object-cover grayscale transition-[filter] duration-500 group-hover:grayscale-0"
                    fallbackText={project.title.slice(0, 3)}
                    sizes={
                      index === 0
                        ? '(max-width: 768px) 100vw, (max-width: 1280px) 100vw, 1280px'
                        : '(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 640px'
                    }
                  />
                  {/* 하단 그라데이션 — 스탬프 가독성 확보 */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent"
                  />
                  <span className="absolute bottom-3 left-4 text-[11px] uppercase tracking-[0.2em] text-white/85">
                    [{project.category}]
                  </span>
                  <span className="absolute bottom-3 right-4 text-[11px] tabular-nums tracking-[0.12em] text-white/70">
                    {toStamp(project.publishedDate, locale)}
                  </span>
                </div>

                <div className="border-t border-white/15 p-5 sm:p-6">
                  <h3
                    className={`font-post font-bold leading-tight text-white ${
                      index === 0 ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'
                    }`}
                  >
                    {project.title}
                  </h3>
                  <p
                    className={`mt-3 text-sm leading-relaxed text-white/65 ${
                      index === 0 ? 'line-clamp-2 max-w-3xl' : 'line-clamp-3'
                    }`}
                    title={summary}
                  >
                    {summary}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>

        {/* 모바일용 전체 보기 — 데스크톱은 킥커 행의 링크가 담당 */}
        <div className="mt-10 sm:hidden">
          <Link
            href="/projects"
            className="inline-flex min-h-[48px] w-full items-center justify-center border border-white/50 px-8 text-sm font-semibold tracking-tight text-white transition-colors duration-300 hover:border-white hover:bg-white/10"
          >
            {t('projects.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  )
}

export default FeaturedProjects
