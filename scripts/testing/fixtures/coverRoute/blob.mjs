/**
 * 표지 업로드 라우트 테스트용 Vercel Blob 스텁.
 *
 * 올라간 객체를 메모리에 담고, 진짜 저장소가 주는 것과 같은 모양의 공개
 * URL(`NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL` 오리진)을 돌려준다 — 라우트가 돌려준
 * 주소가 캠페인 저장(PATCH)의 오리진 대조를 통과하는지 확인해야 하기 때문이다.
 */
export const uploadedObjects = new Map()

export function hasPublicBlobStore() {
  return globalThis.__coverTestBlobConfigured !== false
}

export async function putObject(store, pathname, body, contentType) {
  uploadedObjects.set(pathname, { store, contentType, size: body.length })
  return { url: `${process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL}/${pathname}`, pathname }
}

export async function deleteObject(_store, pathname) {
  uploadedObjects.delete(pathname)
}

export function getPublicUrl(pathname) {
  return `${process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL}/${pathname}`
}

export async function listObjects() {
  return []
}

export async function getPrivateObject() {
  return null
}
