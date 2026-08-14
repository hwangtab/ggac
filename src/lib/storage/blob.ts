import { del, get, put } from '@vercel/blob'

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
 * 비공개 Blob 저장소가 설정돼 있는지. 교차 제공자 폴백 전용이다.
 *
 * 선택된 제공자가 설정돼 있지 않으면 그건 운영 사고이므로 requireEnv가 그대로
 * 던져야 한다. 반면 "반대쪽 제공자에도 있나" 확인하는 폴백에서는 설정이 없는 게
 * 정상 상태(전환 전/롤백 후)다. 그때 requireEnv가 던지면 없는 문서 요청이
 * 404가 아니라 환경변수 이름이 담긴 500으로 나가므로, 폴백은 이 판정으로
 * 먼저 걸러야 한다.
 */
export function hasPrivateBlobStore(): boolean {
  return Boolean(process.env.PRIVATE_BLOB_READ_WRITE_TOKEN?.trim())
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
