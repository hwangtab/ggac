import { isBlobPublicUrl } from '@/lib/storage/paths'

const AUDIO_EXTENSION = /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i

/**
 * 본문 링크를 오디오 플레이어로 그려도 되는가. **우리 Blob 공개 저장소의 음원만**
 * 플레이어가 된다 — 남의 서버 음원은 CSP(`media-src`)에서도 막히고, 재생 요청이
 * 방문자의 주소를 그 서버에 넘긴다. 그 밖의 링크는 평범한 링크로 남는다.
 */
export function isOwnAudioUrl(href: unknown): href is string {
  if (typeof href !== 'string' || !isBlobPublicUrl(href)) return false
  try {
    return AUDIO_EXTENSION.test(new URL(href).pathname)
  } catch {
    return false
  }
}
