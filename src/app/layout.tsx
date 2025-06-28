import type { Metadata } from 'next'
import fs from 'fs'
import path from 'path'
import './globals.css'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import { Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google'
import localFont from 'next/font/local'

const pretendard = localFont({
  src: '../../public/fonts/PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
})

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-sans-kr',
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
    <html lang="ko" className={`${pretendard.variable} ${notoSansKr.variable} ${notoSerifKr.variable}`}>
      <body>
        <Navigation />
        <main>{children}</main>
        <Footer globalData={globalData} />
      </body>
    </html>
  )
}