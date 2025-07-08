import type { Metadata } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Noto_Serif_KR } from 'next/font/google'
import localFont from 'next/font/local'
import { getGlobalData } from '@/lib/data'
import { Suspense } from 'react'

const pretendard = localFont({
  src: '../../public/fonts/PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
})

const notoSerifKr = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-serif-kr',
})

export const metadata: Metadata = {
  title: '경기아트콜렉티브',
  description: '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브입니다.',
  keywords: ['경기아트콜렉티브', '협동조합', '예술', '창작', '경기도', '아티스트', '예술가', '콜라보레이션'],
  authors: [{ name: '경기아트콜렉티브' }],
  creator: '경기아트콜렉티브',
  publisher: '경기아트콜렉티브',
  metadataBase: new URL('https://ggac.kr'),
  alternates: {
    canonical: '/',
    languages: {
      'ko-KR': '/',
    },
  },
  openGraph: {
    title: '경기아트콜렉티브',
    description: '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브입니다.',
    url: 'https://ggac.kr',
    siteName: '경기아트콜렉티브',
    images: [
      {
        url: '/images/logo/gac_og.webp',
        width: 1200,
        height: 630,
        alt: '경기아트콜렉티브 - 경계 없는 상상, 함께 만드는 울림',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '경기아트콜렉티브',
    description: '경계 없는 상상, 함께 만드는 울림',
    images: ['/images/logo/gac_og.webp'],
  },
  icons: {
    icon: '/images/logo/gac_logo.webp',
    shortcut: '/images/logo/gac_logo.webp',
    apple: '/images/logo/gac_logo.webp',
  },
  manifest: '/manifest.webmanifest',
  other: {
    'naver-site-verification': 'c0d96b266d116917a2157019601290e977a0fa8a',
    'google-site-verification': '',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 개선된 데이터 로딩 - 캐싱된 함수 사용
  const globalData = await getGlobalData()

  return (
    <html lang="ko" className={`${pretendard.variable} ${notoSerifKr.variable}`}>
      <body>
        <ErrorBoundary>
          <div className="min-h-screen flex flex-col">
            <Navigation />
            <Suspense fallback={
              <div className="flex-1 pt-20 md:pt-24 flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">페이지를 불러오는 중...</p>
                </div>
              </div>
            }>
              <main className="flex-1">{children}</main>
            </Suspense>
            <Footer globalData={globalData} />
          </div>
        </ErrorBoundary>
      </body>
    </html>
  )
}
