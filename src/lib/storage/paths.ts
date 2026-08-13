export type StorageProvider = 'blob' | 'supabase'

/** 명시적으로 'blob'일 때만 전환한다. 오타·미설정에서 조용히 넘어가지 않게. */
export function currentProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === 'blob' ? 'blob' : 'supabase'
}

export type PutPublicObjectOptions = {
  /**
   * 같은 경로에 이미 객체가 있어도 덮어쓸지. 기본은 false — 있으면 업로드가
   * 실패한다. Supabase storage-js의 upload() 기본값(upsert: false)과
   * @vercel/blob put()의 allowOverwrite 옵션(명시하지 않으면 실패) 둘 다
   * "조용한 덮어쓰기 금지"가 기본이므로, 여기서도 그 기본을 그대로 따른다.
   * 정말로 덮어써야 하는 호출부만 명시적으로 { overwrite: true }를 넘겨야 한다.
   */
  overwrite?: boolean
}

/** putPublicObject 옵션에서 실제 overwrite 여부를 뽑는다. opts 자체가 없거나
 * overwrite가 없으면 false — "덮어쓰기 금지"가 기본이라는 점을 여기 한 곳에서만
 * 결정한다. */
export function resolveOverwrite(opts?: PutPublicObjectOptions): boolean {
  return opts?.overwrite === true
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

export type ProviderName = 'blob' | 'supabase'

export type SettledDeleteResult = {
  provider: ProviderName
  result: PromiseSettledResult<unknown>
}

export type DeleteEverywhereClassification = {
  /** 실패한 제공자 전부 — 이유를 알 수 없는 채로 조용히 넘어가면 안 된다. */
  toLog: { provider: ProviderName; reason: unknown }[]
  shouldThrow: boolean
}

/**
 * deletePublicObjectEverywhere의 순수 판정부.
 *
 * 두 SDK 모두 "없는 객체"에서는 에러를 던지지 않는다 — Vercel Blob의
 * del()은 멱등이고, Supabase storage-js의 remove()는 없는 키에도
 * { error: null }을 준다. 그래서 reject는 메시지가 뭐든 전부 진짜 실패다.
 * "not found"류 메시지를 걸러내던 예전 정규식은 실제로는 절대 안 맞는
 * 케이스를 걸러내려다, 잘못된 토큰이 만드는 "This store does not exist."
 * 같은 진짜 실패까지 조용히 삼켜버렸다 — 그래서 삭제했다.
 *
 * 규칙은 그만큼 단순해진다: 하나라도 실패하면 로그에 남기고, 전부
 * 실패했을 때만 throw한다. 한쪽만 실패해도 호출은 성공으로 치되(기존
 * 전환기 관용은 유지), 실패 사실은 반드시 로그로 보인다.
 */
export function classifyDeleteEverywhereResults(
  results: SettledDeleteResult[]
): DeleteEverywhereClassification {
  const rejected = results.filter(r => r.result.status === 'rejected')
  const toLog = rejected.map(r => ({
    provider: r.provider,
    reason: (r.result as PromiseRejectedResult).reason,
  }))
  return {
    toLog,
    shouldThrow: results.length > 0 && rejected.length === results.length,
  }
}
