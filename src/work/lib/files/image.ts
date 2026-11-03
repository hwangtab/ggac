import sharp from '@/lib/server/sharp'

/**
 * 이미지 처리(서버 전용, sharp). kosmartweb `lib/images/process.ts` 에서 가져와
 * 업무툴용으로 줄였다: 원본은 그대로 두고 webp 썸네일(EXIF 제거·회전 반영)과 크기만 만든다.
 */

// ggac 이식: sharp 는 ggac 의 유일한 진입점(`@/lib/server/sharp`)으로 쓴다 — 모든 로더를 막고 jpeg·png·webp·gif·heif 만
// 다시 연다(SVG·TIFF 디코더는 처음부터 돌지 않는다). 원본의 SVG 로더 차단보다 좁다.

export const THUMB_MAX_WIDTH = 640
/** 디코드 전 입력 픽셀 상한(64MP) — 압축 폭탄으로 서버리스 메모리를 소진시키는 입력 차단 */
const MAX_INPUT_PIXELS = 64_000_000

export type ImageInfo = { width: number; height: number }
export type ThumbnailResult = {
  buffer: Buffer
  contentType: 'image/webp'
  width: number
  height: number
}

/** EXIF orientation 을 반영한 표시 크기. 읽지 못하면 null. */
export async function readImageInfo(input: Buffer): Promise<ImageInfo | null> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    if (!meta.width || !meta.height) return null
    // orientation 5~8 은 가로세로가 뒤바뀐다.
    const swapped = (meta.orientation ?? 1) >= 5
    return swapped
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

/**
 * webp 썸네일. 애니메이션 GIF 는 첫 프레임만 쓴다. 디코드 실패(HEIC 디코더 없음 등)는 null —
 * 호출부는 썸네일 없이 원본만 저장한다.
 */
export async function createThumbnail(
  input: Buffer,
  opts: { maxWidth?: number; quality?: number } = {}
): Promise<ThumbnailResult | null> {
  const { maxWidth = THUMB_MAX_WIDTH, quality = 80 } = opts
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true })
    return { buffer: data, contentType: 'image/webp', width: info.width, height: info.height }
  } catch {
    return null
  }
}
