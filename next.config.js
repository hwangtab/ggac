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

  env: {
    NEXT_PUBLIC_IMAGE_ALLOWED_QUALITIES: IMAGE_ALLOWED_QUALITIES.join(','),
  },

  // 컴파일러 옵션 설정
  compiler: {
    // 프로덕션 빌드에서 console.log 제거 (error, warn은 유지)
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },

  // 최적화된 transpile 패키지 목록 - 필수만 유지
  transpilePackages: [
    '@supabase/supabase-js',
    // react-markdown 제거: 이미 최적화된 패키지이므로 불필요
  ],

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
            // DOMPurify — board/[id] PostContentRenderer에서만 사용 (정적 import).
            // 별도 chunk로 분리해 메인 vendors에서 빼고 board 페이지 진입 시점에만 로드.
            dompurify: {
              test: /[\\/]node_modules[\\/]dompurify[\\/]/,
              name: 'dompurify',
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
            // Supabase 관련 번들
            supabase: {
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
              name: 'supabase',
              type: 'javascript/auto',
              priority: 20,
              reuseExistingChunk: true,
            },
            // 공통 컴포넌트 번들
            common: {
              name: 'common',
              minChunks: 2,
              type: 'javascript/auto',
              priority: 5,
              reuseExistingChunk: true,
            },
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
          {
            key: 'Content-Security-Policy',
            value:
              process.env.NODE_ENV === 'development'
                ? // 개발 환경에서 완화된 CSP - CSS MIME 타입 오류 방지
                  [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval'",
                    "style-src 'self' 'unsafe-inline'",
                    "style-src-elem 'self' 'unsafe-inline'",
                    "img-src 'self' data: https: blob:",
                    "connect-src 'self' http://localhost:* https: ws://localhost:* wss://localhost:* https://*.supabase.co wss://*.supabase.co",
                    "font-src 'self' data:",
                    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
                    "object-src 'none'",
                    "base-uri 'self'",
                    "worker-src 'self' blob:",
                    "manifest-src 'self'",
                  ].join('; ')
                : [
                    "default-src 'self'",
                    // 일반 HTML 라우트는 src/middleware/csp.ts에서 요청별 nonce + strict-dynamic
                    // CSP를 우선 주입한다. 이 정적 헤더는 fallback이며, 미들웨어가 CSP 적용을
                    // 건너뛰는 에디터 경로(board/write, board/[id]/edit)에 한해 적용된다.
                    // 에디터는 react-quill의 인라인 스크립트 호환을 위해 'unsafe-inline' 유지.
                    "script-src 'self' 'unsafe-inline'" +
                      (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') +
                      ' https://www.youtube.com https://www.google-analytics.com',
                    // 스크립트 요소별 세밀한 제어 - CSS 파일을 script로 처리하지 않도록 명시적 제외
                    "script-src-elem 'self' 'unsafe-inline'" +
                      (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') +
                      ' https://www.youtube.com https://www.google-analytics.com',
                    // 스타일 정책
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
                    // 폰트 정책
                    "font-src 'self' https://fonts.gstatic.com",
                    // 이미지 정책 - data: URI 추가 (Next.js Image blur 지원), Supabase storage 추가
                    "img-src 'self' https: blob: data: https://*.supabase.co",
                    // 미디어 정책
                    "media-src 'self' https://www.youtube.com https://*.supabase.co",
                    // 프레임 정책
                    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
                    // 연결 정책
                    process.env.NODE_ENV === 'development'
                      ? "connect-src 'self' http://localhost:* https://api.supabase.io https://*.supabase.co ws://localhost:* wss://localhost:* wss://*.supabase.co"
                      : "connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co",
                    // 객체 및 기타 보안 정책
                    "object-src 'none'",
                    "base-uri 'self'",
                    "form-action 'self'",
                    "frame-ancestors 'none'",
                    // 워커 및 매니페스트 정책
                    "worker-src 'self' blob:",
                    "manifest-src 'self'",
                    // 플러그인 차단은 object-src 'none'으로 처리 (plugin-types는 deprecated)
                    // CSP 위반 리포팅
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
