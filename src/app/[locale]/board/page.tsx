// 하이브리드 렌더링: 서버 컴포넌트 + 클라이언트 하이드레이션
import { Suspense } from 'react'
import BoardServerData from './BoardServerData'
import { generateBreadcrumbStructuredData, structuredDataToScript } from '@/utils/structuredData'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseBoardCategory } from '@/constants/categories'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'

export const revalidate = 60

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; category?: string }>
}): Promise<Metadata> {
  const resolved = (await searchParams) ?? {}
  const page = parseIntegerParam(resolved.page ?? null, 1, { min: 1 })
  const canonical = page > 1 ? `/board?page=${page}` : '/board'

  return {
    title: '자유게시판',
    description:
      '경기아트콜렉티브 협동조합 조합원들의 이야기, 공지, 활동 소식을 나누는 공간입니다.',
    keywords: ['자유게시판', '경기아트콜렉티브', '공지', '활동소식', '협동조합게시판'],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    alternates: {
      canonical,
      languages: { 'ko-KR': canonical },
    },
    openGraph: {
      title: '자유게시판 | 경기아트콜렉티브 협동조합',
      description: '경기아트콜렉티브 협동조합 조합원들의 이야기와 활동 소식을 나눕니다.',
      url: canonical,
      siteName: '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합',
        },
      ],
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: '자유게시판 | 경기아트콜렉티브 협동조합',
      description: '경기아트콜렉티브 협동조합 조합원들의 이야기와 활동 소식을 나눕니다.',
      images: ['/images/logo/gac_og.webp'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

interface BoardPageProps {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{
    category?: string
    page?: string
  }>
}

const boardBreadcrumbJsonLd = structuredDataToScript(
  generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '자유게시판', url: 'https://ggac.kr/board' },
  ])
)

const BoardPage = async ({ params, searchParams }: BoardPageProps) => {
  const { locale } = await params
  setRequestLocale(locale)
  const resolved = (await searchParams) ?? {}
  const category = parseBoardCategory(resolved.category) ?? '전체'
  const page = parseIntegerParam(resolved.page ?? null, 1, { min: 1 })

  return (
    <>
      {boardBreadcrumbJsonLd}
      <div>
        <Suspense
          fallback={
            <div className="pt-24 md:pt-28 container mx-auto px-4">
              <div className="h-6 w-40 bg-gray-200 rounded mb-4 animate-pulse" />
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-white p-6 rounded-lg shadow-md animate-pulse">
                    <div className="w-24 h-4 bg-gray-200 rounded mb-2" />
                    <div className="w-2/3 h-6 bg-gray-200 rounded mb-3" />
                    <div className="w-full h-16 bg-gray-200 rounded" />
                  </div>
                ))}
              </div>
            </div>
          }
        >
          <BoardServerData category={category} page={page} pageSize={15} />
        </Suspense>
      </div>
    </>
  )
}

export default BoardPage
