import type { Metadata } from 'next'
import ErrorBoundary from '@/components/ErrorBoundary'
import ConditionalLayout from '@/components/ConditionalLayout'
import { getGlobalData } from '@/lib/data'
import { Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale, getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { getSiteUrl, getLocaleAlternates, getOgLocale, getSupabaseOrigin } from '@/utils/site'

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }))
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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
    ? 'Sounds that break the mold, resonance we build together. Gyeonggi Art Collective — breathing through art, forging a path through cooperation.'
    : '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 경기아트콜렉티브입니다.'
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
            ? 'Gyeonggi Art Collective — sounds that break the mold'
            : '경기아트콜렉티브 - 경계 없는 상상, 함께 만드는 울림',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: isEn
        ? 'Sounds that break the mold, resonance we build together.'
        : '경계 없는 상상, 함께 만드는 울림',
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

  const supabaseOrigin = getSupabaseOrigin()

  return (
    <html lang={locale}>
      {/* 아티스트·첨부 이미지가 Supabase Storage(*.supabase.co)에서 로드되므로
          연결 지연을 줄여 이미지 LCP를 개선한다. Metadata API가 커버하지 않는
          <link> 태그는 컴포넌트 트리 어디에 렌더해도 Next.js가 <head>로 호이스트한다. */}
      {supabaseOrigin && (
        <>
          <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={supabaseOrigin} />
        </>
      )}
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
                    <p className="text-gray-600">{t('loading')}</p>
                  </div>
                </div>
              }
            >
              <ConditionalLayout globalData={globalData}>{children}</ConditionalLayout>
            </Suspense>

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
