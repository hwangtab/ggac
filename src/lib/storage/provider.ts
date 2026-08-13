import { deleteObject, getPublicUrl, putObject } from './blob'
import { currentProvider, isBlobPublicUrl, logicalPathFromUrl, splitBucketPath } from './paths'
import { deleteSupabaseObject, putSupabaseObject, supabasePublicUrl } from './supabase'

export type { StorageProvider } from './paths'
// 순수 경로/판정 함수는 여기서 재export한다 — 이후 태스크의 라우트 코드는
// @/lib/storage/provider 하나만 import하면 되도록.
export { currentProvider, isBlobPublicUrl, logicalPathFromUrl, splitBucketPath }

export async function putPublicObject(
  pathname: string,
  body: Buffer,
  contentType: string
): Promise<{ url: string; pathname: string }> {
  if (currentProvider() === 'blob') return putObject('public', pathname, body, contentType)
  const { bucket, key } = splitBucketPath(pathname)
  return putSupabaseObject(bucket, key, body, contentType)
}

export async function deletePublicObject(pathname: string): Promise<void> {
  if (currentProvider() === 'blob') return deleteObject('public', pathname)
  const { bucket, key } = splitBucketPath(pathname)
  return deleteSupabaseObject(bucket, key)
}

/**
 * 전환기 전용. 어느 제공자에 있든 지운다. 없는 객체는 성공으로 친다.
 * 한쪽만 실패해도 그 사유를 남긴다 — 조용한 부분 실패를 막기 위해.
 */
export async function deletePublicObjectEverywhere(pathname: string): Promise<void> {
  const { bucket, key } = splitBucketPath(pathname)
  const results = await Promise.allSettled([
    deleteObject('public', pathname),
    deleteSupabaseObject(bucket, key),
  ])

  const realFailures = results.filter(
    r => r.status === 'rejected' && !/not.?found|does not exist/i.test(String(r.reason))
  )
  for (const f of realFailures) {
    console.warn(
      `[storage] 부분 삭제 실패 ${pathname}: ${String((f as PromiseRejectedResult).reason)}`
    )
  }
  if (realFailures.length === results.length) {
    throw new Error(`삭제 실패: ${pathname}`)
  }
}

export function publicUrlFor(pathname: string): string {
  if (currentProvider() === 'blob') return getPublicUrl(pathname)
  const { bucket, key } = splitBucketPath(pathname)
  return supabasePublicUrl(bucket, key)
}
