const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const { buildCsp, reportingEndpointsValue } = require('./src/config/cspPolicy')

const IMAGE_ALLOWED_QUALITIES = [50, 65, 75, 80, 85, 90, 100]

/** kordoc이 createRequire로 런타임에 불러오는 모듈(+ 그 의존성) — kosmart-work next.config.ts와 같다 */
const KORDOC_RUNTIME_REQUIRES = [
  './node_modules/cfb/**',
  './node_modules/adler-32/**',
  './node_modules/crc-32/**',
]
const KORDOC_VIEWER_EXCLUDES = [
  './node_modules/onnxruntime-node/**',
  './node_modules/@hyzyla/**',
  './node_modules/pdfjs-dist/**',
  './node_modules/@napi-rs/**',
  './node_modules/@huggingface/**',
]
/**
 * kordoc을 쓰는 라우트 — 이사회 업무툴 문서 미리보기(docs/board-work/01-설계.md §7-3). 라우트를 더하면 여기에도 적는다
 * (빠지면 운영에서 "Cannot find module 'cfb'"로 HWP·XLS 변환이 전부 실패하고, 제외가 빠지면 번들이 250MB를 넘는다).
 */
// 키는 picomatch 글롭이라 동적 구간의 대괄호를 이스케이프한다(문자 집합으로 읽히지 않게).
const KORDOC_ROUTES = [
  '/api/board-room/work/files/\\[id\\]/render',
  // 자료실의 이사회 서류 미리보기(03 §10 — 첨부 render와 같은 변환기)
  '/api/board-room/work/board-documents/\\[id\\]/render',
  // 이사회 업무툴 문서 편집(3단계 — HWP 양식 칸·문구 블록·초안·편집기 저장본 검증·초안 미리보기)
  '/api/board-room/work/files/\\[id\\]/form',
  '/api/board-room/work/files/\\[id\\]/blocks',
  '/api/board-room/work/files/\\[id\\]/draft',
  '/api/board-room/work/files/\\[id\\]/drafts/\\[uploadId\\]/verify',
  '/api/board-room/work/files/\\[id\\]/drafts/\\[uploadId\\]/render',
  '/api/board-room/work/files/new-drafts/\\[uploadId\\]/verify',
  '/api/board-room/work/files/new-drafts/\\[uploadId\\]/render',
  // 조합원 내 문서함(docs/board-work/04-조합원-문서함.md) — 미리보기와, HWP·HWPX 편집기 저장본을 검사하는 승격 라우트
  '/api/mypage/documents/files/\\[versionId\\]/render',
  '/api/mypage/documents',
  '/api/mypage/documents/\\[id\\]/versions',
  // 이사회 서류 앱 편집(docs/board-work/05-이사회-서류-앱-편집.md) — HWP·HWPX 저장본 검사와 웹 본문 다시 만들기
  '/api/board-room/documents/\\[id\\]/versions',
]
/**
 * 이사회 업무툴 본문 추출 크론(설계 §8-2). PDF 를 읽으므로 pdfjs-dist(+ DOMMatrix 폴리필 @napi-rs/canvas)는 남기고
 * OCR 쪽 무거운 것만 뺀다 — kosmart-work next.config.ts 의 '/api/internal/extract-texts'와 같다.
 */
const KORDOC_EXTRACT_ROUTE = '/api/internal/board-work/extract-texts'
/**
 * pdfjs-dist 는 Node 에서 DOMMatrix·Path2D 폴리필로 @napi-rs/canvas 를 동적으로 require 해 파일 추적이 놓친다
 * (2026-11-03 실측: 추적 결과에 pdfjs-dist 3.0MB 는 있고 @napi-rs 는 0). 플랫폼 바이너리 패키지까지 명시로 넣는다.
 */
const KORDOC_EXTRACT_INCLUDES = [...KORDOC_RUNTIME_REQUIRES, './node_modules/@napi-rs/canvas*/**']
const KORDOC_EXTRACT_EXCLUDES = [
  './node_modules/onnxruntime-node/**',
  './node_modules/@hyzyla/**',
  './node_modules/@huggingface/**',
]

/**
 * 이사회 업무툴 앱 안 편집기 출처(설계 §8-1) — `NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`(예 https://ggac-office.vercel.app).
 * 비었거나 https(로컬은 http://localhost·127.0.0.1)가 아니면 빈 값 — frame-src 에 아무것도 더하지 않는다(편집 기능도 숨는다).
 * 판정은 src/work/lib/files/office-edit.ts getOfficeEditorOrigin 과 같다(미들웨어 CSP 는 그 함수를 쓴다).
 */
function officeEditorFrameOrigin(raw) {
  const value = (raw || '').trim()
  if (!value) return ''
  try {
    const u = new URL(value)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin
  } catch {
    // 잘못된 주소
  }
  return ''
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 권한 E2E의 운영 빌드(`playwright.config.ts`)만 `.next-e2e`로 뺀다 — 같은 워크트리의
  // `next dev`가 쓰는 `.next`를 빌드가 덮어 `Cannot find module './NNNN.js'`로 서로 깨뜨리지 않게.
  // 배포·`npm run build`는 이 변수를 주지 않으므로 그대로 `.next`다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // 파일 추적 루트를 이 저장소로 고정한다 — 홈 디렉터리의 다른 lockfile 때문에 Next가 루트를 잘못 짚어
  // 추적 경로(outputFileTracingIncludes)가 어긋났다(이사회 업무툴 0단계 스파이크 실측, 설계 §7-5).
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ['127.0.0.1'],

  // data/*.json은 src/lib/data.ts가 process.cwd() 기반 동적 경로로 fs 읽기하므로
  // Vercel output file tracing이 추적하지 못해 서버리스 번들(/var/task)에서 누락된다.
  // (sitemap.xml의 artists/projects ENOENT 5개월 — 전 라우트에 명시 포함으로 해소)
  outputFileTracingIncludes: {
    '/**': ['./data/**/*'],
    // kordoc은 cfb(HWP5·XLS의 OLE 컨테이너)를 createRequire로 불러 파일 추적이 놓친다
    // (kosmart-work 운영에서 "Cannot find module 'cfb'"로 모든 변환이 실패했다). kordoc을 쓰는 라우트마다 넣는다.
    ...Object.fromEntries(KORDOC_ROUTES.map(r => [r, KORDOC_RUNTIME_REQUIRES])),
    [KORDOC_EXTRACT_ROUTE]: KORDOC_EXTRACT_INCLUDES,
  },
  // kordoc의 선택 의존성(OCR·PDF 엔진) 중 쓰지 않는 무거운 것을 함수 번들에서 뺀다
  // (onnxruntime-node만 약 300MB — 250MB 한도 초과). 뷰어는 OCR을 끄고 PDF는 변환하지 않는다.
  outputFileTracingExcludes: {
    ...Object.fromEntries(KORDOC_ROUTES.map(r => [r, KORDOC_VIEWER_EXCLUDES])),
    [KORDOC_EXTRACT_ROUTE]: KORDOC_EXTRACT_EXCLUDES,
  },
  // kordoc은 번들하지 않고 node_modules에서 그대로 로드한다(createRequire·동적 import 때문).
  serverExternalPackages: ['kordoc'],

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
  webpack: (config, { dev, isServer }) => {
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
      // poll: 이 저장소는 외부 드라이브(/Volumes/Crucial X8)에 있어 파일 이벤트(FSEvents)가
      // 누락된다. 폴링을 끄면 저장해도 HMR이 안 돈다.
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
    }

    // 프로덕션에서 번들 크기 경고 제거
    if (!dev) {
      config.performance = {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000,
      }
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

  // 실험적 기능 활성화
  experimental: {
    optimizeCss: false, // CSS 최적화 비활성화 - CSS를 스크립트로 잘못 로드하는 문제 방지
    // 개발 환경 최적화
    ...(process.env.NODE_ENV === 'development' && {
      forceSwcTransforms: true,
    }),
    // 프로덕션 최적화
    ...(process.env.NODE_ENV === 'production' && {
      optimizeServerReact: true,
    }),
  },

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
            // 최신 지침은 0 — 구형 XSS 필터 자체가 취약점의 원인이 된다. 방어는 CSP가 한다.
            key: 'X-XSS-Protection',
            value: '0',
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
          // 지시문의 정본은 src/config/cspPolicy.js — 두 곳이 같은 함수를 쓴다.
          {
            key: 'Content-Security-Policy',
            value: buildCsp({
              dev: process.env.NODE_ENV === 'development',
              officeOrigin: officeEditorFrameOrigin(process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN),
            }),
          },
          // Report-To 는 폐기됐다. report-to 지시문은 이 헤더의 엔드포인트 이름을 가리킨다.
          {
            key: 'Reporting-Endpoints',
            value: reportingEndpointsValue(process.env.NEXT_PUBLIC_SITE_URL),
          },
        ],
      },
    ]
  },

  images: {
    // 외부 이미지 도메인 허용
    remotePatterns: [
      // Vercel Blob 공개 저장소 (실제 호스트만 허용, 와일드카드 금지 —
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
    // SVG는 최적화기에 넣지 않는다. 최적화 경로의 SVG 렌더링이 RCE였고
    // (CVE-2026-96889), next/image는 `.svg` src를 자동으로 unoptimized 처리한다.
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // 이미지 최적화 오류 시 fallback 허용
    unoptimized: false,
    // 이미지 품질 설정 (Next.js 16 대비)
    qualities: IMAGE_ALLOWED_QUALITIES,
  },
}

module.exports = withBundleAnalyzer(withNextIntl(nextConfig))
