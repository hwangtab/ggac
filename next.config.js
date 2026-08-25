const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const IMAGE_ALLOWED_QUALITIES = [50, 65, 75, 80, 85, 90, 100]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],

  // data/*.json은 src/lib/data.ts가 process.cwd() 기반 동적 경로로 fs 읽기하므로
  // Vercel output file tracing이 추적하지 못해 서버리스 번들(/var/task)에서 누락된다.
  // (sitemap.xml의 artists/projects ENOENT 5개월 — 전 라우트에 명시 포함으로 해소)
  outputFileTracingIncludes: {
    '/**': ['./data/**/*'],
  },

  env: {
    NEXT_PUBLIC_IMAGE_ALLOWED_QUALITIES: IMAGE_ALLOWED_QUALITIES.join(','),
  },

  // 컴파일러 옵션 설정
  compiler: {
    // 프로덕션 빌드에서 console.log 제거 (error, warn은 유지)
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },

  // 최적화된 transpile 패키지 목록 - 필수만 유지
  // 단계 4 Task 5에서 `@supabase/supabase-js`를 뺐다. src/ 어디도 이 패키지를
  // import하지 않으므로(정적 가드가 0개를 강제한다) Next 번들에 들어올 일이
  // 없고, 남겨두면 "아직 앱이 Supabase를 쓴다"는 잘못된 신호만 준다. 이관·
  // 컷오버 스크립트(scripts/)는 Next 번들러를 거치지 않으므로 영향이 없다.
  transpilePackages: [],

  // 번들 최적화 설정
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // 개발 환경 최적화
    if (dev) {
      // 개발 모드에서 빌드 속도 향상
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      }

      // HMR 성능 향상
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: /node_modules/,
      }
    }

    // 프로덕션 환경에서만 고급 최적화 적용
    if (!dev && !isServer) {
      // 번들 분할 최적화
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            // 무거운 에디터 묶음 — board write/edit에서만 dynamic import되는데
            // 기본 vendor 룰이 chunks:'all'이라 메인으로 빨려들어가던 회귀를 방지.
            // lodash.isequal/clonedeep은 quill-delta의 transitive dep.
            quill: {
              test: /[\\/]node_modules[\\/](react-quill-new|quill|parchment|quill-delta|fast-diff|lodash\.isequal|lodash\.clonedeep)[\\/]/,
              name: 'quill',
              chunks: 'async',
              type: 'javascript/auto',
              priority: 30,
              reuseExistingChunk: true,
            },
            // 프로필 사진 크롭 — mypage/profile에서만 사용 (정적 import이므로 chunks:'all'로 자체 청크 유지)
            imageCrop: {
              test: /[\\/]node_modules[\\/]react-image-crop[\\/]/,
              name: 'image-crop',
              chunks: 'all',
              type: 'javascript/auto',
              priority: 30,
              reuseExistingChunk: true,
            },
            // sanitize-html(+파서 의존성) — board/[id] PostContentRenderer에서만 사용.
            // 별도 chunk로 분리해 메인 vendors에서 빼고 board 페이지 진입 시점에만 로드.
            // (기존 dompurify 그룹 대체 — isomorphic-dompurify/jsdom은 SSR ERR_REQUIRE_ESM으로 제거됨)
            sanitizeHtml: {
              test: /[\\/]node_modules[\\/](sanitize-html|htmlparser2|dom-serializer|domhandler|domutils|parse-srcset|deepmerge|is-plain-object|postcss|entities)[\\/]/,
              name: 'sanitize-html',
              chunks: 'all',
              type: 'javascript/auto',
              priority: 30,
              reuseExistingChunk: true,
            },
            // react-markdown — 게시글/아티스트 bio 렌더링 시점에만 필요
            reactMarkdown: {
              test: /[\\/]node_modules[\\/](react-markdown|mdast-util-.*|micromark.*|unified|hast-util-.*|unist-util-.*|vfile.*|bail|trough|is-plain-obj|trim-lines|space-separated-tokens|comma-separated-tokens|property-information|html-url-attributes|character-entities.*|decode-named-character-reference|devlop|estree-util-is-identifier-name|extend|longest-streak|markdown-table|zwitch|stringify-entities|ccount|escape-string-regexp)[\\/]/,
              name: 'react-markdown',
              chunks: 'all',
              type: 'javascript/auto',
              priority: 28,
              reuseExistingChunk: true,
            },
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              type: 'javascript/auto',
              priority: 10,
              reuseExistingChunk: true,
            },
            // React 아이콘 별도 번들
            reactIcons: {
              test: /[\\/]node_modules[\\/]react-icons[\\/]/,
              name: 'react-icons',
              type: 'javascript/auto',
              priority: 20,
              reuseExistingChunk: true,
            },
            // 공통 컴포넌트 번들(common cacheGroup)은 제거했다.
            // minChunks:2 + chunks:'all'이 앱 전역에서 2개 이상 청크가 쓰는 모든
            // 모듈을 단일 common.js로 병합하는데, OptimizedImage·ErrorBoundary 같은
            // 준-전역 유틸이 포함돼 모든 페이지가 이 청크를 로드했다. 그 결과 board-room·
            // admin·mypage·에디터 전용 컴포넌트(약 48kB)까지 홈·게시판·아티스트 등
            // 공개 페이지 초기 번들에 함께 새어 들어갔다(unused-javascript).
            // 이 커스텀 그룹을 제거하면 webpack 기본 default cacheGroup이 공유 코드를
            // 라우트 그룹 단위로만 스코프해, 전 라우트 First Load JS가 19~28kB 감소한다.
          },
        },
      }

      // 트리 쉐이킹 최적화
      // sideEffects: false 는 제거 — Supabase, Framer Motion 등 초기화 코드가 있는
      // 외부 패키지를 의도치 않게 트리쉐이킹할 수 있어 런타임 오류를 유발할 수 있음
      config.optimization.usedExports = true
      config.optimization.providedExports = true

      // 더 공격적인 압축 설정
      if (config.optimization.minimizer) {
        config.optimization.minimizer.forEach(minimizer => {
          if (minimizer.constructor.name === 'TerserPlugin') {
            minimizer.options = {
              ...minimizer.options,
              terserOptions: {
                ...minimizer.options.terserOptions,
                compress: {
                  ...minimizer.options.terserOptions?.compress,
                  drop_debugger: true,
                  // production 번들에서 console.log/debug/info 제거.
                  // console.error/warn은 운영 진단 가치가 있어 유지.
                  // 개발 환경(NODE_ENV=development)에서는 dev 빌드라 적용되지 않음.
                  pure_funcs: ['console.log', 'console.debug', 'console.info'],
                },
                mangle: {
                  safari10: true,
                },
              },
            }
          }
        })
      }
    }

    // 모든 환경에서 적용할 플러그인
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.NEXT_IS_SERVER': JSON.stringify(isServer.toString()),
        'process.env.NEXT_IS_DEV': JSON.stringify(dev.toString()),
        'process.env.BUILD_ID': JSON.stringify(buildId),
      })
    )

    // 프로덕션에서 번들 크기 경고 제거
    if (!dev) {
      config.performance = {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000,
      }
    }

    // 해상도 별칭 추가로 번들 크기 최적화
    config.resolve.alias = {
      ...config.resolve.alias,
    }

    // 불필요한 모듈 제외
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    }

    return config
  },

  // External packages configuration for Next.js 14+ (deprecated serverExternalPackages removed)

  // 실험적 기능 활성화
  experimental: {
    optimizeCss: false, // CSS 최적화 비활성화 - CSS를 스크립트로 잘못 로드하는 문제 방지
    optimizePackageImports: ['react-icons', 'date-fns', 'lodash-es'],
    // 개발 환경 최적화
    ...(process.env.NODE_ENV === 'development' && {
      forceSwcTransforms: true,
    }),
    // 프로덕션 최적화
    ...(process.env.NODE_ENV === 'production' && {
      optimizeServerReact: true,
    }),
  },

  // Turbopack 설정 (개발 모드)
  ...(process.env.NODE_ENV === 'development' && {
    turbopack: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  }),

  // Vercel에서 동적 라우트 인식 개선
  trailingSlash: false,
  skipTrailingSlashRedirect: true,

  // 동적 API 라우트 최적화
  generateEtags: false,
  poweredByHeader: false,
  compress: true,

  // 구 `/archive` 경로 영구 이전 → `/projects`.
  // 이 페이지는 지난 기록만이 아니라 예정 공연도 싣기 때문에 '아카이브'라는 이름이
  // 실제 내용과 맞지 않았다. 검색엔진에 이미 색인된 URL과 외부에서 걸린 링크가
  // 살아 있으므로 308(permanent)로 넘겨 랭킹을 새 경로에 승계시킨다.
  //
  // 순서 주의: next.config의 redirects는 미들웨어(next-intl locale rewrite)보다
  // 먼저 평가된다(Next.js 라우팅 파이프라인: headers → redirects → middleware).
  // 따라서 `/archive/foo`는 여기서 `/projects/foo`로 바뀐 뒤 미들웨어가
  // `/ko/projects/foo`로 rewrite한다. ko는 localePrefix가 'as-needed'라 URL에
  // 접두사가 없고, en만 `/en` 접두사를 쓰므로 두 형태를 모두 등록한다.
  async redirects() {
    return [
      { source: '/archive', destination: '/projects', permanent: true },
      { source: '/archive/:slug', destination: '/projects/:slug', permanent: true },
      { source: '/en/archive', destination: '/en/projects', permanent: true },
      { source: '/en/archive/:slug', destination: '/en/projects/:slug', permanent: true },
    ]
  },

  // Enhanced security headers (keep simple for static assets)
  async headers() {
    return [
      // Ensure CSS is served with correct MIME and nosniff to prevent accidental script execution
      {
        source: '/_next/static/css/(.*)',
        headers: [
          { key: 'Content-Type', value: 'text/css; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Explicitly prevent CSS files from being treated as scripts
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        ],
      },
      // JavaScript 파일에 대한 명시적 MIME 타입 설정
      {
        source: '/_next/static/chunks/(.*)',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      // Next static assets: rely on Next/Vercel defaults, only add caching.
      // X-Robots-Tag로 검색 엔진이 정적 자원을 색인하지 않도록 명시
      // (GSC "크롤링됨 - 색인 안 됨" 노이즈 제거).
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Robots-Tag',
            value: 'noindex',
          },
        ],
      },
      // WebP 이미지 파일
      {
        source: '/images/(.*\\.webp)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // AVIF 이미지 파일
      {
        source: '/images/(.*\\.avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // JPEG 이미지 파일
      {
        source: '/images/(.*\\.jpg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      {
        source: '/images/(.*\\.jpeg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // PNG 이미지 파일
      {
        source: '/images/(.*\\.png)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // SVG 이미지 파일
      {
        source: '/images/(.*\\.svg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // 웹폰트 파일들
      {
        source: '/(.*\\.woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      {
        source: '/(.*\\.woff)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      {
        source: '/(.*\\.ttf)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      // 정적 이미지 파일에 대한 일반 캐시 헤더 (fallback)
      {
        source: '/images/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      // 정적 파일과 API 제외 - MIME 타입 충돌 방지 (CSS/JS는 상단 규칙에 의해 처리됨)
      {
        source: '/((?!api|_next/static|favicon|images|robots|sitemap).*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // Content-Security-Policy: 정상 HTML 응답은 src/middleware/csp.ts가
          // 요청별로 주입하며 이 정적 헤더를 덮어쓴다. 이 정적 CSP는 미들웨어를
          // 거치지 않는 경로(점(.) 포함 경로의 HTML 404 등)를 위한 백스톱이다.
          // (미들웨어가 직접 생성하는 유지보수/가입중단 HTML은 middleware.ts의
          // copyResponseCookies가 CSP를 전파해 커버한다.)
          // ⚠️ 내용을 바꿀 때는 src/middleware/csp.ts의 프로덕션 CSP와 함께 동기화할 것.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // dev에서는 Next dev 런타임(eval 기반 HMR)이 죽지 않도록 'unsafe-eval'
              // 허용 — 이 정적 헤더는 미들웨어가 CSP를 붙이지 않는 경로에도 적용되므로,
              // 여기서 프로덕션 CSP만 두면 정상 dev(NEXT_STRICT_CSP 미설정)의 하이드레이션이
              // 통째로 죽는다. src/middleware/csp.ts의 dev 분기와 동일 패턴.
              process.env.NODE_ENV === 'development'
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:"
                : "script-src 'self' 'unsafe-inline' https:",
              "script-src-elem 'self' 'unsafe-inline' https:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              process.env.NODE_ENV === 'development'
                ? "img-src 'self' https: http://localhost:* http://127.0.0.1:* blob: data: https://*.supabase.co"
                : "img-src 'self' https: blob: data: https://*.supabase.co",
              process.env.NODE_ENV === 'development'
                ? "media-src 'self' http://localhost:* http://127.0.0.1:* https://www.youtube.com https://*.supabase.co"
                : "media-src 'self' https://www.youtube.com https://*.supabase.co",
              "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
              // 로컬 Supabase 스택(supabase start)은 http://127.0.0.1:5442x에 뜬다.
              // 이 분기가 없어 `supabase start`로 띄운 스택에 앱이 아예 붙지 못했다.
              process.env.NODE_ENV === 'development'
                ? "connect-src 'self' http://localhost:* http://127.0.0.1:* https://api.supabase.io https://*.supabase.co ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* wss://*.supabase.co"
                : "connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              'report-uri /api/security/csp-report',
              'report-to default',
            ].join('; '),
          },
          {
            key: 'Report-To',
            value: JSON.stringify({
              group: 'default',
              max_age: 86400,
              endpoints: [{ url: '/api/security/csp-report' }],
              include_subdomains: true,
            }),
          },
        ],
      },
    ]
  },

  images: {
    // 외부 이미지 도메인 허용
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      // Vercel Blob 공개 저장소 (전환기: 실제 호스트만 허용, 와일드카드 금지 —
      // *.public.blob.vercel-storage.com은 다른 Vercel 고객의 공개 저장소까지 허용한다)
      {
        protocol: 'https',
        hostname: 'r8qnr9c7mestxusj.public.blob.vercel-storage.com',
        port: '',
        pathname: '/**',
      },
      // YouTube 썸네일 도메인
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/vi/**',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '/vi/**',
      },
      // 네이버 관련 이미지 도메인 (일반)
      {
        protocol: 'https',
        hostname: '*.pstatic.net',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.naver.com',
        port: '',
        pathname: '/**',
      },
      // 뉴스아트 이미지 도메인
      {
        protocol: 'https',
        hostname: 'www.news-art.co.kr',
        port: '',
        pathname: '/data/**',
      },
      // 링크 프리뷰용 일반 이미지 도메인 (보안상 제한적 허용)
      // 외부 일반 도메인 와일드카드 제거: 비허용 도메인은 이미지 프록시 경유
    ],
    // 최적화된 이미지 형식 우선순위 (모바일 우선)
    formats: ['image/webp', 'image/avif'],
    // 모바일 우선 디바이스 크기 설정 (320px 추가로 모바일 성능 향상)
    deviceSizes: [320, 640, 828, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 320, 384],
    // 캐시 수명 — 정적 자산은 길게(31일)가 재방문 LCP에 유리.
    // 이미지가 변경되면 파일명/쿼리스트링이 바뀌므로 stale 콘텐츠 위험은 거의 없음.
    minimumCacheTTL: process.env.NODE_ENV === 'development' ? 600 : 60 * 60 * 24 * 31, // dev 10m / prod 31d
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // 이미지 최적화 오류 시 fallback 허용
    unoptimized: false,
    // 이미지 품질 설정 (Next.js 16 대비)
    qualities: IMAGE_ALLOWED_QUALITIES,
  },
}

module.exports = withBundleAnalyzer(withNextIntl(nextConfig))
