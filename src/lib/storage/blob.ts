import { del, get, list, put } from '@vercel/blob'

type StoreKind = 'public' | 'private'

export type PrivateObjectResult = {
  statusCode: number
  stream: ReadableStream | null
  contentType: string
  etag: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function tokenFor(store: StoreKind): string {
  return store === 'public'
    ? requireEnv('PUBLIC_BLOB_READ_WRITE_TOKEN')
    : requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')
}

/**
 * 공개 Blob 저장소가 설정돼 있는지.
 *
 * 업로드·삭제 라우트가 **작업을 시작하기 전에** 자격 증명을 확인하는 데 쓴다.
 * 확인 없이 진행하면 토큰이 없는 배포에서 `del()`이 던지고, 그 예외를 로그만
 * 남기고 삼키는 호출부(아티스트 사진 DELETE 등)가 실제로는 아무것도 지우지
 * 않은 채 200을 내려준다. 사전 검증은 그 무음 성공을 500으로 바꾼다.
 *
 * `requireEnv`와 같은 기준을 쓰되(비어 있으면 없는 것), 앞뒤 공백만 있는
 * 값도 없는 것으로 본다 — 환경변수 편집 실수로 개행 하나가 들어간 상태를
 * "설정됨"으로 오인하면 사전 검증이 통과해 버린다.
 */
export function hasPublicBlobStore(): boolean {
  return Boolean(process.env.PUBLIC_BLOB_READ_WRITE_TOKEN?.trim())
}

export async function putObject(
  store: StoreKind,
  pathname: string,
  body: Buffer,
  contentType: string,
  // 이 함수를 provider.ts 밖에서 직접 부르는 기존 호출부(스모크 테스트)를
  // 깨지 않기 위해 기본값은 기존 하드코딩 그대로 true를 유지한다.
  // provider.ts의 putPublicObject는 이 기본값에 기대지 않고 매번 명시적으로 값을 넘긴다.
  allowOverwrite: boolean = true
): Promise<{ url: string; pathname: string }> {
  const blob = await put(pathname, body, {
    access: store,
    contentType,
    token: tokenFor(store),
    // 경로를 우리가 결정하므로 무작위 접미사를 붙이지 않는다.
    addRandomSuffix: false,
    allowOverwrite,
  })

  return { url: blob.url, pathname: blob.pathname }
}

export async function deleteObject(store: StoreKind, pathname: string): Promise<void> {
  await del(pathname, { token: tokenFor(store) })
}

/** 공개 저장소 전용. 브라우저가 직접 가져간다. */
export function getPublicUrl(pathname: string): string {
  return `${requireEnv('NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL').replace(/\/$/, '')}/${pathname}`
}

/**
 * 비공개 저장소 전용. 호출자(라우트)가 먼저 권한을 검사한 뒤 이 결과를 스트리밍한다.
 * 없는 객체면 null을 돌려준다.
 */
export async function getPrivateObject(
  pathname: string,
  ifNoneMatch?: string
): Promise<PrivateObjectResult | null> {
  const result = await get(pathname, {
    access: 'private',
    token: tokenFor('private'),
    ifNoneMatch,
  })

  if (!result) return null

  return {
    statusCode: result.statusCode,
    stream: result.stream,
    contentType: result.blob.contentType,
    etag: result.blob.etag,
  }
}

/** `listObjects`가 돌려주는 한 객체. `@vercel/blob`의 목록 응답은 contentType을
 * 주지 않는다 — 목록에서 MIME이 필요하면 확장자로 추정해야 한다. */
export type ListedObject = {
  pathname: string
  url: string
  size: number
  uploadedAt: Date
}

/**
 * 접두사 아래 객체를 나열한다. 재귀적이다(`mode: 'folded'`를 쓰지 않으므로
 * 하위 "폴더"의 객체까지 평평하게 나온다).
 *
 * `limit`은 Blob API가 한 번에 돌려주는 최대 개수이며 상한은 1000이다. 이
 * 저장소의 사용자별 업로드는 그 규모에 한참 못 미치므로 커서 페이지네이션을
 * 쓰지 않는다 — 필요해지면 `cursor`를 노출할 것.
 */
export async function listObjects(
  store: StoreKind,
  prefix: string,
  limit: number
): Promise<ListedObject[]> {
  const { blobs } = await list({
    prefix,
    limit: Math.min(Math.max(limit, 1), 1000),
    token: tokenFor(store),
  })
  return blobs.map(b => ({
    pathname: b.pathname,
    url: b.url,
    size: b.size,
    uploadedAt: b.uploadedAt,
  }))
}
