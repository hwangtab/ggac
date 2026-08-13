import { deleteObject, getPublicUrl, putObject } from './blob'
import {
  classifyDeleteEverywhereResults,
  currentProvider,
  isBlobPublicUrl,
  logicalPathFromUrl,
  resolveOverwrite,
  splitBucketPath,
  type PutPublicObjectOptions,
} from './paths'
import { deleteSupabaseObject, putSupabaseObject, supabasePublicUrl } from './supabase'

export type { StorageProvider, PutPublicObjectOptions } from './paths'
// 순수 경로/판정 함수는 여기서 재export한다 — 이후 태스크의 라우트 코드는
// @/lib/storage/provider 하나만 import하면 되도록.
export { currentProvider, isBlobPublicUrl, logicalPathFromUrl, splitBucketPath }

export async function putPublicObject(
  pathname: string,
  body: Buffer,
  contentType: string,
  opts?: PutPublicObjectOptions
): Promise<{ url: string; pathname: string }> {
  const overwrite = resolveOverwrite(opts)
  if (currentProvider() === 'blob') {
    return putObject('public', pathname, body, contentType, overwrite)
  }
  const { bucket, key } = splitBucketPath(pathname)
  return putSupabaseObject(bucket, key, body, contentType, overwrite)
}

export async function deletePublicObject(pathname: string): Promise<void> {
  if (currentProvider() === 'blob') return deleteObject('public', pathname)
  const { bucket, key } = splitBucketPath(pathname)
  return deleteSupabaseObject(bucket, key)
}

/**
 * 전환기 전용. 어느 제공자에 있든 지운다.
 *
 * 두 SDK 모두 없는 객체에서 에러를 던지지 않으므로(Blob del은 멱등,
 * Supabase remove는 없는 키/버킷에도 성공), reject는 전부 진짜 실패로
 * 취급한다 — classifyDeleteEverywhereResults 참고. 한쪽만 실패해도
 * 호출 자체는 성공으로 치되, 그 실패는 반드시 로그에 남긴다. 둘 다
 * 실패했을 때만 throw한다.
 */
export async function deletePublicObjectEverywhere(pathname: string): Promise<void> {
  const { bucket, key } = splitBucketPath(pathname)
  const [blobResult, supabaseResult] = await Promise.allSettled([
    deleteObject('public', pathname),
    deleteSupabaseObject(bucket, key),
  ])

  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    { provider: 'blob', result: blobResult },
    { provider: 'supabase', result: supabaseResult },
  ])

  for (const { provider, reason } of toLog) {
    console.warn(`[storage] ${provider} 삭제 실패 ${pathname}: ${String(reason)}`)
  }
  if (shouldThrow) {
    throw new Error(`삭제 실패: ${pathname}`)
  }
}

export function publicUrlFor(pathname: string): string {
  if (currentProvider() === 'blob') return getPublicUrl(pathname)
  const { bucket, key } = splitBucketPath(pathname)
  return supabasePublicUrl(bucket, key)
}
