import { deleteObject, putObject } from './blob'
import {
  isBlobPublicUrl,
  logicalPathFromUrl,
  resolveOverwrite,
  splitBucketPath,
  type PutPublicObjectOptions,
} from './paths'

export type { PutPublicObjectOptions } from './paths'
// 순수 경로/판정 함수는 여기서 재export한다 — 라우트 코드는
// @/lib/storage/provider 하나만 import하면 되도록.
export { isBlobPublicUrl, logicalPathFromUrl, splitBucketPath }

/**
 * 공개 객체 저장은 Vercel Blob 하나뿐이다.
 *
 * 단계 4(Task 5)에서 Supabase 클라이언트를 전부 걷어내면서 제공자 분기
 * (`STORAGE_PROVIDER` 환경변수 + `currentProvider()`)도 함께 사라졌다.
 * 분기를 남겨두면 환경변수를 설정하지 않은 배포가 조용히 "이제 존재하지 않는
 * 제공자"로 떨어지므로, 갈림길 자체를 없애는 편이 안전하다.
 */
export async function putPublicObject(
  pathname: string,
  body: Buffer,
  contentType: string,
  opts?: PutPublicObjectOptions
): Promise<{ url: string; pathname: string }> {
  return putObject('public', pathname, body, contentType, resolveOverwrite(opts))
}

/**
 * 없는 객체에도 실패하지 않는다 — `@vercel/blob`의 `del()`은 멱등이다.
 * 그래서 여기서 나오는 reject는 전부 진짜 실패이고, 호출부는 그 사실을
 * 반드시 로그로 드러내야 한다(삼키더라도 조용히 삼키지 말 것).
 */
export async function deletePublicObject(pathname: string): Promise<void> {
  return deleteObject('public', pathname)
}
