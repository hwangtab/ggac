import type { Metadata } from 'next'
import fs from 'fs'
import path from 'path'
import './globals.css'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: '경기아트콜렉티브 협동조합',
  description: '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브 협동조합입니다.',
  keywords: ['경기아트콜렉티브', '협동조합', '예술', '창작', '경기도', '아티스트', '예술가', '콜라보레이션'],
  authors: [{ name: '경기아트콜렉티브 협동조합' }],
  creator: '경기아트콜렉티브 협동조합',
  publisher: '경기아트콜렉티브 협동조합',
  metadataBase: new URL('https://ggac.kr'),
  alternates: {
    canonical: '/',
    languages: {
      'ko-KR': '/',
    },
  },
  openGraph: {
    title: '경기아트콜렉티브 협동조합',
    description: '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브 협동조합입니다.',
    url: 'https://ggac.kr',
    siteName: '경기아트콜렉티브 협동조합',
    images: [
      {
        url: '/images/logo/gac_og.webp',
        width: 1200,
        height: 630,
        alt: '경기아트콜렉티브 협동조합 - 경계 없는 상상, 함께 만드는 울림',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '경기아트콜렉티브 협동조합',
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
    'naver-site-verification': '',
    'google-site-verification': '',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // global.json 데이터 로드
  const globalData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/global.json'), 'utf8')
  )

  return (
    <html lang="ko">
      <body>
        <Navigation />
        <main>{children}</main>
        <Footer globalData={globalData} />
      </body>
    </html>
  )
}