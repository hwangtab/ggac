export type StorageProvider = 'blob' | 'supabase'

/** 명시적으로 'blob'일 때만 전환한다. 오타·미설정에서 조용히 넘어가지 않게. */
export function currentProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === 'blob' ? 'blob' : 'supabase'
}

export function splitBucketPath(pathname: string): { bucket: string; key: string } {
  if (typeof pathname !== 'string' || !pathname || pathname.startsWith('/')) {
    throw new Error(`invalid pathname: ${JSON.stringify(pathname)}`)
  }
  const segments = pathname.split('/')
  if (segments.length < 2 || segments.some(s => s === '' || s === '..' || s === '.')) {
    throw new Error(`invalid pathname: ${JSON.stringify(pathname)}`)
  }
  return { bucket: segments[0], key: segments.slice(1).join('/') }
}

/**
 * Vercel Blob 공개 저장소의 URL인지 판정한다. origin을 정확히 대조하므로
 * 접미사 위조(`...vercel-storage.com.evil.com`)와 userinfo 트릭에 견딘다.
 * BLOB_PUBLIC_BASE_URL이 없으면 항상 false다.
 */
export function isBlobPublicUrl(value: string): boolean {
  const base = process.env.BLOB_PUBLIC_BASE_URL
  if (!base || typeof value !== 'string' || !value) return false

  try {
    return new URL(value).origin === new URL(base).origin
  } catch {
    return false
  }
}

const SUPABASE_PUBLIC_MARKER = '/storage/v1/object/public/'

/**
 * 저장된 절대 URL에서 논리 경로 `<bucket>/<key>`를 되돌린다.
 * 양쪽 제공자 형식을 받되, 기대한 버킷·접두사와 다르면 null을 준다.
 * 이 확인은 기존 getProjectStorageObjectPath가 하던 봉쇄를 유지하기 위한 것이다.
 */
export function logicalPathFromUrl(
  url: string,
  expectedBucket: string,
  pathPrefix = ''
): string | null {
  if (typeof url !== 'string' || !url) return null

  let logical: string | null = null

  if (isBlobPublicUrl(url)) {
    try {
      logical = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null
    } catch {
      return null
    }
  } else {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) return null
    try {
      const parsed = new URL(url)
      if (parsed.origin !== new URL(supabaseUrl).origin) return null
      const idx = parsed.pathname.indexOf(SUPABASE_PUBLIC_MARKER)
      if (idx === -1) return null
      logical =
        decodeURIComponent(parsed.pathname.slice(idx + SUPABASE_PUBLIC_MARKER.length)) || null
    } catch {
      return null
    }
  }

  if (!logical) return null

  let parts
  try {
    parts = splitBucketPath(logical)
  } catch {
    return null
  }

  if (parts.bucket !== expectedBucket) return null

  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  if (normalizedPrefix && !parts.key.startsWith(`${normalizedPrefix}/`)) return null

  return logical
}
