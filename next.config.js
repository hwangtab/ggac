const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 최적화된 transpile 패키지 목록 - 필수만 유지
  transpilePackages: [
    '@supabase/auth-helpers-nextjs',
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

      // 개발 환경에서 Supabase 모듈 로딩 안정성 향상
      config.resolve.alias = {
        ...config.resolve.alias,
        '@supabase/supabase-js': require.resolve('@supabase/supabase-js'),
        '@supabase/auth-helpers-nextjs': require.resolve('@supabase/auth-helpers-nextjs'),
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
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              priority: 10,
              reuseExistingChunk: true,
            },
            // React 아이콘 별도 번들
            reactIcons: {
              test: /[\\/]node_modules[\\/]react-icons[\\/]/,
              name: 'react-icons',
              priority: 20,
              reuseExistingChunk: true,
            },
            // Framer Motion 별도 번들
            framerMotion: {
              test: /[\\/]node_modules[\\/]framer-motion[\\/]/,
              name: 'framer-motion',
              priority: 20,
              reuseExistingChunk: true,
            },
            // Supabase 관련 번들
            supabase: {
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
              name: 'supabase',
              priority: 20,
              reuseExistingChunk: true,
            },
            // 공통 컴포넌트 번들
            common: {
              name: 'common',
              minChunks: 2,
              priority: 5,
              reuseExistingChunk: true,
            },
          },
        },
      }

      // 트리 쉐이킹 최적화
      config.optimization.usedExports = true
      config.optimization.providedExports = true
      config.optimization.sideEffects = false

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
                  drop_console: true,
                  drop_debugger: true,
                  pure_funcs: ['console.log', 'console.debug'],
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
      // lodash 트리 쉐이킹
      lodash: 'lodash-es',
      // moment.js 대신 date-fns 사용 권장
      moment: 'date-fns',
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
    optimizeCss: true, // CSS 최적화
    optimizePackageImports: ['react-icons', 'framer-motion', 'date-fns', 'lodash-es'],
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

  // 서버리스 함수 최적화
  serverRuntimeConfig: {
    maxDuration: 30,
  },

  // SEO 및 메타데이터 라우트 설정
  async rewrites() {
    return {
      beforeFiles: [
        // SEO 파일들을 API로 리다이렉트
        {
          source: '/sitemap.xml',
          destination: '/api/sitemap',
        },
        {
          source: '/robots.txt',
          destination: '/api/robots',
        },
      ],
    }
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
        ],
      },
      // Next static assets: rely on Next/Vercel defaults, only add caching
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // WebP 이미지 파일
      {
        source: '/images/(.*\\.webp)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      // AVIF 이미지 파일
      {
        source: '/images/(.*\\.avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      // JPEG 이미지 파일
      {
        source: '/images/(.*\\.jpg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      {
        source: '/images/(.*\\.jpeg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      // PNG 이미지 파일
      {
        source: '/images/(.*\\.png)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      // SVG 이미지 파일
      {
        source: '/images/(.*\\.svg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
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
            value: 'public, max-age=86400',
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
            value: [
              "default-src 'self'",
              // React-Quill 호환을 위한 스크립트 정책 (개발 환경에서 React Refresh 지원)
              "script-src 'self' 'unsafe-inline'" +
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
              // Remove upgrade-insecure-requests in development to allow HTTP
              ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
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
      // 네이버 예약 이미지 도메인
      {
        protocol: 'https',
        hostname: 'naverbooking-phinf.pstatic.net',
        port: '',
        pathname: '/**',
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
    // 최적화된 이미지 형식 우선순위
    formats: ['image/webp', 'image/avif'],
    // 최적화된 디바이스 크기 설정 (불필요한 크기 제거로 성능 향상)
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // 개발환경 최적화: 빠른 업데이트를 위한 단축된 캐시 시간
    minimumCacheTTL: process.env.NODE_ENV === 'development' ? 3600 : 86400, // 개발: 1시간, 프로덕션: 24시간
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // 이미지 최적화 오류 시 fallback 허용
    unoptimized: false,
    // 외부 도메인에 대한 더 관대한 정책
    domains: [], // deprecated이지만 호환성을 위해 유지
  },
}

module.exports = withBundleAnalyzer(nextConfig)
