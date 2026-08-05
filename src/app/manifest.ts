import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '경기아트콜렉티브 협동조합',
    short_name: 'GAC',
    description: '서울 밖에서 시끄러워집니다',
    start_url: '/',
    display: 'standalone',
    // 사이트 전체가 다크 포스터 테마다. 스플래시·브라우저 크롬도 맞춘다.
    background_color: '#08080a',
    theme_color: '#08080a',
    icons: [
      {
        src: '/images/logo/gac_logo.webp',
        sizes: '192x192',
        type: 'image/webp',
      },
      {
        src: '/images/logo/gac_og.webp',
        sizes: '1200x630',
        type: 'image/webp',
        purpose: 'any',
      },
    ],
  }
}
