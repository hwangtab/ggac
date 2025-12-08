import { MetadataRoute } from 'next'
import { getSiteUrl } from '@/utils/site'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl()

  return {
    rules: [
      // 일반 크롤러
      {
        userAgent: '*',
        allow: '/',
      },
      // 주요 검색 엔진
      {
        userAgent: 'Googlebot',
        allow: '/',
      },
      {
        userAgent: 'Naverbot',
        allow: '/',
      },
      {
        userAgent: 'Yeti',
        allow: '/',
      },
      // AI 검색 엔진 봇 명시적 허용
      {
        userAgent: 'GPTBot',
        allow: '/',
      },
      {
        userAgent: 'CCBot',
        allow: '/',
      },
      {
        userAgent: 'Google-Extended',
        allow: '/',
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
