import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '경기아트콜렉티브 협동조합',
    short_name: 'GAC',
    description: '경계 없는 상상, 함께 만드는 울림',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0ea5e9',
    icons: [
      {
        src: '/images/logo/gac_logo.webp',
        sizes: 'any',
        type: 'image/webp',
      },
    ],
  }
}
