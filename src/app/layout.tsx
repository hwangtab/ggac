import type { Metadata } from 'next'
import './globals.css'
import ErrorBoundary from '@/components/ErrorBoundary'
import ConditionalLayout from '@/components/ConditionalLayout'
import { getGlobalData } from '@/lib/data'
import { Suspense } from 'react'
import Script from 'next/script'
import { Toaster } from 'react-hot-toast'
import { headers } from 'next/headers'

// 폰트는 globals.css의 @import 'pretendard/.../pretendardvariable-dynamic-subset.css'로 로드된다.
// 브라우저가 unicode-range 매칭 기반으로 실제 사용 글자가 포함된 서브셋만 자동 fetch.

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export const metadata: Metadata = {
  title: {
    default: '경기아트콜렉티브 협동조합',
    template: '%s | 경기아트콜렉티브 협동조합',
  },
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
    siteName: '경기아트콜렉티브 협동조합',
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
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    other: {
      'naver-site-verification': 'c0d96b266d116917a2157019601290e977a0fa8a',
    },
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 개선된 데이터 로딩 - 캐싱된 함수 사용
  const globalData = await getGlobalData()

  // CSP nonce는 middleware/csp.ts에서 에디터 경로일 때만 x-nonce 헤더로 주입.
  // layout은 이 헤더가 있으면 Script에 nonce prop 전달, 없으면 undefined.
  // headers() 호출은 모든 경로에서 발생하므로, layout 전체가 dynamic으로 전환됨.
  // → 정적 prerender 이득은 getServerData 캐싱으로 일부 보상.
  const headersList = await headers()
  const nonce = headersList.get('x-nonce') || undefined

  return (
    <html lang="ko">
      <body suppressHydrationWarning>
        <Script
          id="css-script-guard"
          strategy="beforeInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var isCss = function(node){
    if (!node || node.tagName !== 'SCRIPT') return false;
    var src = node.getAttribute('src') || '';
    return src.indexOf('/_next/static/css/') !== -1 && src.endsWith('.css');
  };
  var convert = function(node){
    if (!isCss(node) || !node.parentNode) return;
    var link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', node.getAttribute('src'));
    node.parentNode.replaceChild(link, node);
  };
  var scan = function(){
    document.querySelectorAll('script[src*="/_next/static/css/"]').forEach(convert);
  };
  var observer = new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes && m.addedNodes.forEach(convert);
    });
  });
  var head = document.head || document.getElementsByTagName('head')[0];
  if (head) observer.observe(head, { childList: true, subtree: true });
  scan();
})();`,
          }}
        />
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
            <ConditionalLayout globalData={globalData}>
              {children}
            </ConditionalLayout>
          </Suspense>

          {/* Toast notifications */}
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
      </body>
    </html>
  )
}
