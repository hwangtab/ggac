import type { Metadata } from 'next'
import ErrorBoundary from '@/components/ErrorBoundary'
import ConditionalLayout from '@/components/ConditionalLayout'
import { getGlobalData } from '@/lib/data'
import { Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale, getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }))
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // 모바일 브라우저 크롬(주소창)까지 다크로. 없으면 사이트만 검고 위쪽 띠가 밝다.
  themeColor: '#08080a',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()

  const title = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
  const description = isEn
    ? 'A cooperative of indie musicians and bands from Gyeonggi, Korea — doom metal, punk, and experimental music, with self-produced live shows.'
    : '경기도 인디 뮤지션·밴드가 만든 생산자 협동조합. 둠메탈·펑크·실험음악을 만들고 공연을 직접 기획합니다.'
  const siteName = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
  const alternates = getLocaleAlternates('/', locale)

  return {
    title: {
      default: title,
      template: isEn ? `%s | Gyeonggi Art Collective` : `%s | 경기아트콜렉티브 협동조합`,
    },
    description,
    keywords: isEn
      ? ['Gyeonggi Art Collective', 'cooperative', 'arts', 'Gyeonggi', 'artists', 'collaboration']
      : [
          '경기아트콜렉티브',
          '협동조합',
          '예술',
          '창작',
          '경기도',
          '아티스트',
          '예술가',
          '콜라보레이션',
        ],
    authors: [{ name: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브' }],
    creator: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브',
    publisher: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브',
    metadataBase: new URL(base),
    alternates,
    openGraph: {
      title,
      description,
      url: isEn ? `${base}/en` : base,
      siteName,
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: isEn
            ? 'Gyeonggi Art Collective — getting loud outside seoul'
            : '경기아트콜렉티브 협동조합 — 서울 밖에서 시끄러워집니다',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: isEn ? 'Getting loud outside Seoul' : '서울 밖에서 시끄러워집니다',
      images: ['/images/logo/gac_og.webp'],
    },
    icons: {
      icon: '/images/logo/gac_logo.webp',
      shortcut: '/images/logo/gac_logo.webp',
      apple: '/images/logo/gac_logo.webp',
    },
    manifest: '/manifest.webmanifest',
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
      other: {
        'naver-site-verification': 'c0d96b266d116917a2157019601290e977a0fa8a',
      },
    },
  }
}

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params

  // 정적 prerender를 보존하기 위해 setRequestLocale 호출 (headers() 불필요)
  setRequestLocale(locale)

  const [globalData, messages, t] = await Promise.all([
    getGlobalData(locale),
    getMessages(),
    getTranslations({ locale, namespace: 'common' }),
  ])

  return (
    <html lang={locale}>
      <body suppressHydrationWarning>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ErrorBoundary>
            <div className="skip-links">
              <a href="#main-content" className="skip-link">
                {t('skipToMain')}
              </a>
              <a href="#navigation" className="skip-link">
                {t('skipToNav')}
              </a>
            </div>

            {/* 주의: 여기(루트 레이아웃)에 children을 감싸는 Suspense를 두면 모든
                페이지에 스트리밍 경계가 생겨 응답이 200으로 먼저 flush되고,
                이후의 notFound()가 404 상태코드를 반환할 수 없게 된다(soft-404 —
                미존재 게시글이 200+안내문으로 응답돼 검색엔진 soft 404 분류 대상,
                2026-07 전수감사 백로그). useSearchParams를 쓰는 컴포넌트의 경계는
                각 페이지가 자체 Suspense로 감당한다. */}
            <ConditionalLayout globalData={globalData}>{children}</ConditionalLayout>

            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
                loading: {
                  iconTheme: {
                    primary: '#3b82f6',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </ErrorBoundary>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
