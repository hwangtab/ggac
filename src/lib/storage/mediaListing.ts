/**
 * `GET /api/media/upload`의 목록 변환부(순수 함수).
 *
 * 라우트에서 분리한 이유는 두 가지다. 하나는 라우트 파일이 sharp를 import해서
 * 단위 테스트에서 부르기 어렵다는 것, 다른 하나는 이 변환이 **저장소 응답
 * 형태를 화면 계약(MediaFile)으로 옮기는 유일한 지점**이라 회귀가 조용히
 * 생기기 쉬운 자리라는 것이다.
 *
 * 이 파일은 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때
 * 쓰는 타입 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다.
 *
 * **Supabase Storage에서 Blob으로 넘어오며 두 가지가 달라졌다**(단계 4 Task 5):
 * - MIME 타입: Supabase `list()`는 객체 메타데이터에 `mimetype`을 담아 줬지만
 *   Blob 목록 응답에는 그 필드가 없다. 그래서 확장자로 추정한다. 추정할 수
 *   없으면 `application/octet-stream`으로 둔다(예전 코드도 메타데이터가 비면
 *   같은 값으로 떨어졌다).
 * - 그 밖의 임의 메타데이터: Supabase가 주던 `file.metadata`가 사라졌다.
 *   `metadata`에는 이제 우리가 계산한 variants 정보만 담긴다.
 */

export type StoredObject = {
  /** 저장소 전체 경로. 버킷 이름까지 포함한다(`attachments/attachments/<uid>/a.webp`). */
  pathname: string
  url: string
  size: number
  uploadedAt: Date
}

export type MediaVariantPaths = {
  original: string
  webp?: string
  fallback?: string
}

export type MediaVariantUrls = {
  original?: string
  webp?: string
  fallback?: string
}

export type MediaListingEntry = {
  id: string
  name: string
  size: number
  type: string
  path: string
  public_url: string
  variants: MediaVariantPaths
  variant_urls: MediaVariantUrls
  uploaded_at: string
  metadata: Record<string, unknown>
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
}

/** 마지막 `.` 이후를 확장자로 본다. 없으면 빈 문자열. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return ''
  return fileName.slice(dot).toLowerCase()
}

export function mimeTypeFromFileName(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream'
}

/**
 * 저장소 객체 목록을 화면 계약(MediaFile 호환)으로 옮긴다.
 *
 * @param objects   `listObjects`가 돌려준 것. `bucket/` 접두사가 붙은 전체 경로.
 * @param bucket    논리 버킷명. 응답의 `path`는 예전과 같이 **버킷 상대** 경로여야
 *                  하므로 이 접두사를 떼어낸다.
 * @param basePrefix 버킷 상대 기준 경로(`attachments/<uid>`). 응답 `path` 조립에 쓴다.
 *
 * webp/폴백 변형은 목록에서 빼고 원본 항목의 `variants`로만 노출한다 —
 * 화면에 같은 사진이 3벌씩 뜨지 않게 하기 위한 기존 동작 그대로다.
 */
export function toMediaListing(
  objects: StoredObject[],
  bucket: string,
  basePrefix: string
): MediaListingEntry[] {
  const bucketPrefix = `${bucket}/`
  const byName = new Map<string, StoredObject>()

  for (const object of objects) {
    if (!object.pathname.startsWith(bucketPrefix)) continue
    const relative = object.pathname.slice(bucketPrefix.length)
    const basePrefixWithSlash = `${basePrefix}/`
    if (!relative.startsWith(basePrefixWithSlash)) continue
    const name = relative.slice(basePrefixWithSlash.length)
    // 하위 디렉터리는 목록에 넣지 않는다 — 예전 Supabase `list()`도
    // 접두사 바로 아래 한 단계만 돌려줬다. Blob `list()`는 재귀적이라
    // 이 판정이 없으면 하위 경로 객체가 이름에 `/`를 달고 섞여 들어온다.
    if (!name || name.includes('/')) continue
    byName.set(name, object)
  }

  const entries: MediaListingEntry[] = []

  for (const [name, object] of byName) {
    if (name.endsWith('.webp') || name.endsWith('.fallback.jpg')) continue

    const ext = extensionOf(name)
    const baseName = ext ? name.slice(0, name.length - ext.length) : name
    const webpName = `${baseName}.webp`
    const fallbackName = `${baseName}.fallback.jpg`

    const webpObject = byName.get(webpName)
    const fallbackObject =
      byName.get(fallbackName) ?? (['.jpg', '.jpeg'].includes(ext) ? object : undefined)

    const variants: MediaVariantPaths = {
      original: `${basePrefix}/${name}`,
      webp: webpObject ? `${basePrefix}/${webpName}` : undefined,
      fallback: fallbackObject
        ? fallbackObject === object
          ? `${basePrefix}/${name}`
          : `${basePrefix}/${fallbackName}`
        : undefined,
    }

    const variant_urls: MediaVariantUrls = {
      original: object.url,
      webp: webpObject?.url,
      fallback: fallbackObject?.url,
    }

    entries.push({
      id: `${bucket}-${name}-${entries.length}`,
      name,
      size: object.size,
      type: mimeTypeFromFileName(name),
      path: variants.webp || variants.original,
      public_url: variant_urls.webp || variant_urls.original || '',
      variants,
      variant_urls,
      uploaded_at: object.uploadedAt.toISOString(),
      metadata: { variants, variant_urls },
    })
  }

  return entries
}
