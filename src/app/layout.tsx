import type { Metadata } from 'next'
import './globals.css'
import ErrorBoundary from '@/components/ErrorBoundary'
import ConditionalLayout from '@/components/ConditionalLayout'
import localFont from 'next/font/local'
import { getGlobalData } from '@/lib/data'
import { Suspense } from 'react'
import Script from 'next/script'

const gmarketSans = localFont({
  src: '../../public/fonts/GmarketSansTTFLight.ttf',
  variable: '--font-gmarket-sans',
  display: 'swap',
  preload: true,
})

const okGung = localFont({
  src: '../../public/fonts/OK GUNG.ttf',
  variable: '--font-ok-gung',
  display: 'swap',
  preload: true,
})

const santokki = localFont({
  src: '../../public/fonts/HSSanTokki2.0(2024).ttf',
  variable: '--font-santokki',
  display: 'swap',
  preload: true,
})

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  title: '경기아트콜렉티브',
  description:
    '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브입니다.',
  keywords: [
    '경기아트콜렉티브',
    '협동조합',
    '예술',
    '창작',
    '경기도',
    '아티스트',
    '예술가',
    '콜라보레이션',
  ],
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
    description:
      '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브입니다.',
    url: 'https://ggac.kr',
    siteName: '경기아트콜렉티브',
    images: [
      {
        url: '/images/logo/gac_og_branded.webp',
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
    images: ['/images/logo/gac_og_branded.webp'],
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 개선된 데이터 로딩 - 캐싱된 함수 사용
  const globalData = await getGlobalData()

  return (
    <html lang="ko" className={`${gmarketSans.variable} ${okGung.variable} ${santokki.variable}`}>
      <body suppressHydrationWarning>
        {/* Guard against accidental CSS being loaded as <script> by third-party/preload mishaps */}
        <ErrorBoundary>
          {/* Skip Links for Keyboard Navigation */}
          <div className="skip-links">
            <a href="#main-content" className="skip-link">
              메인 콘텐츠로 건너뛰기
            </a>
            <a href="#navigation" className="skip-link">
              내비게이션으로 건너뛰기
            </a>
          </div>

          <Suspense
            fallback={
              <div
                className="min-h-screen flex items-center justify-center"
                role="status"
                aria-live="polite"
              >
                <div className="text-center">
                  <div
                    className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"
                    aria-hidden="true"
                  ></div>
                  <p className="text-gray-600">페이지를 불러오는 중...</p>
                </div>
              </div>
            }
          >
            <ConditionalLayout globalData={globalData}>{children}</ConditionalLayout>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  )
}
