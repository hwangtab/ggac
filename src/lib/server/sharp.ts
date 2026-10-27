/**
 * 업로드·외부 이미지를 다루는 **유일한** sharp 진입점.
 *
 * sharp는 입력 포맷을 선언된 MIME이 아니라 **바이트로** 판정한다. 그래서
 * `file.type`이 `image/png`여도 내용이 SVG면 librsvg가 그 파일을 렌더링한다.
 * 2026-10 Next.js 대역외 패치(CVE-2026-96889)가 바로 이 librsvg의
 * use-after-free였다 — sharp 0.35.5(rsvg 2.63.2)로 막혔지만, 우리가 받는 포맷
 * 밖의 디코더는 애초에 돌 이유가 없다.
 *
 * 그래서 libvips 로더를 전부 막고 업로드 허용 목록(`MAGIC_BYTE_SIGNATURES`·
 * 아티스트 사진 `ALLOWED_TYPES`)에 있는 포맷만 다시 연다. HEIF는 AVIF 로더를
 * 겸한다. 막힌 포맷은 `Input buffer contains unsupported image format`로
 * 던지며, 호출부는 원래 sharp 실패를 처리하던 경로로 그대로 흡수한다.
 *
 * `block`은 프로세스 전역이다 — 이 모듈을 한 번이라도 로드한 서버리스
 * 인스턴스에서는 같은 프로세스의 다른 sharp 사용(로컬 `next start`의 이미지
 * 최적화 포함)에도 똑같이 걸린다. 의도한 것이다.
 *
 * 로더 이름은 libvips 클래스명이다. 틀리면 조용히 아무것도 열리지 않으므로
 * sharp를 올릴 때 jpeg·png·webp·gif·avif가 읽히고 svg·tiff가 거부되는지
 * 다시 확인한다.
 */
import sharp from 'sharp'

sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({
  operation: [
    'VipsForeignLoadJpeg',
    'VipsForeignLoadPng',
    'VipsForeignLoadWebp',
    'VipsForeignLoadNsgif',
    'VipsForeignLoadHeif',
  ],
})

export default sharp
