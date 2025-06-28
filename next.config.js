/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // 로컬 이미지는 domains 불필요
    formats: ['image/webp', 'image/avif'],
    // 더 효율적인 디바이스 크기 설정
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // 더 공격적인 최적화를 위한 설정
    minimumCacheTTL: 86400, // 24시간 캐시
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
}

module.exports = nextConfig