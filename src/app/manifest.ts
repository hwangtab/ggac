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
    // gac_og.webp(1200x630, OG 공유 이미지)는 정사각형이 아니라 아이콘으로
    // 부적절해 icons 배열에서 제외한다. 실측 결과 gac_logo.webp는 실제로
    // 500x500이라(선언값 192x192는 부정확했음) 실제 크기로 바로잡고,
    // Android 적응형 아이콘을 위해 같은 파일로 maskable 항목도 추가한다.
    // TODO: 진짜 512x512 아이콘 원본이 생기면 교체할 것.
    icons: [
      {
        src: '/images/logo/gac_logo.webp',
        sizes: '500x500',
        type: 'image/webp',
        purpose: 'any',
      },
      {
        src: '/images/logo/gac_logo.webp',
        sizes: '500x500',
        type: 'image/webp',
        purpose: 'maskable',
      },
    ],
  }
}
