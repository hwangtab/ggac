/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel에서는 자동으로 최적화되므로 export 모드 제거
  trailingSlash: true,
  images: {
    unoptimized: true,
    domains: ['ggac.kr', 'www.ggac.kr', 'vercel.app', 'ggac-wkr6.vercel.app']
  },
  // 빌드 최적화
  experimental: {
    optimizeCss: true,
  },
  // 환경별 설정
  env: {
    CUSTOM_KEY: process.env.NODE_ENV,
    SITE_URL: process.env.NODE_ENV === 'production' ? 'https://ggac.kr' : 'http://localhost:3000'
  }
}

module.exports = nextConfig