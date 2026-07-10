// 하이브리드 렌더링: 서버 컴포넌트(ISR) + 클라이언트 필터·하이드레이션
import { Suspense } from 'react'
import BoardServerData from './BoardServerData'
import { generateBreadcrumbStructuredData, structuredDataToScript } from '@/utils/structuredData'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  // 페이지네이션(?page=)은 클라이언트로 이관됨 — generateMetadata에서 searchParams를
  // 읽으면 라우트가 동적 렌더링으로 전환되므로 canonical은 목록 루트로 고정한다.
  const canonical = '/board'

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
}

const boardBreadcrumbJsonLd = structuredDataToScript(
  generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '자유게시판', url: 'https://ggac.kr/board' },
  ])
)

// 카테고리·페이지(?category=, ?page=)는 ServerBoardView(클라이언트)가
// parseBoardCategory allowlist로 검증해 파생한다. 서버에서 searchParams를
// 읽으면 /board가 동적 렌더링으로 전환되어 revalidate=60이 사문화된다(전수감사 P3).
const BoardPage = async ({ params }: BoardPageProps) => {
  const { locale } = await params
  setRequestLocale(locale)

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
          <BoardServerData pageSize={15} />
        </Suspense>
      </div>
    </>
  )
}

export default BoardPage
